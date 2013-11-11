﻿(function () {
    'use strict';

    TLRGRP.namespace('TLRGRP.BADGER.Dashboard.Components');

    function calculateNextRefresh(nextServerSideRefresh) {
        var adjustedNextServerSideRefresh = moment(nextServerSideRefresh).add(500, 'ms');
        var refreshIn = moment(adjustedNextServerSideRefresh).diff(moment());
        var minRefreshInterval = 1000;

        if (refreshIn < minRefreshInterval) {
            refreshIn = minRefreshInterval;
        }

        return refreshIn;
    }
    
    TLRGRP.BADGER.Dashboard.Components.HealthCheck = function (configuration) {
        var currentTimeout;
        var refreshServerBaseUrl = 'http://' + configuration.host + ':' + configuration.port + '/';
        var inlineLoading = new TLRGRP.BADGER.Dashboard.ComponentModules.InlineLoading();
        var lastUpdated = new TLRGRP.BADGER.Dashboard.ComponentModules.LastUpdated();
        var inlineError = new TLRGRP.BADGER.Dashboard.ComponentModules.Error();
        var serverList = new TLRGRP.BADGER.Dashboard.ComponentModules.HealthCheckServerList();
        var componentLayout = new TLRGRP.BADGER.Dashboard.ComponentModules.ComponentLayout({
            title: configuration.title,
            componentClass: 'health-check-component',
            modules: [
                inlineLoading,
                lastUpdated,
                inlineError,
                serverList
            ]
        });

        var stateMachine = nano.Machine({
            states: {
                uninitialised: {
                    initialise: function (container) {
                        componentLayout.appendTo(container);

                        return this.transitionToState('initialising');
                    }
                },
                initialising: {
                    _onEnter: function () {
                        return $.ajax({
                            url: refreshServerBaseUrl + 'servers/' + configuration.serverSet,
                            success: function (groups) {
                                stateMachine.handle('complete', groups);
                                stateMachine.handle('start');
                            },
                            error: function (errorInfo) {
                                stateMachine.handle('error', errorInfo);
                            }
                        });
                    },
                    complete: function (groups) {
                        serverList.setGroups(groups);
                        
                        this.transitionToState('paused');
                    }
                },
                failedToInitialise: {
                    _onEnter: function (errorInfo) {
                        if (errorInfo && errorInfo.responseJSON && errorInfo.responseJSON.error) {
                            componentLayout.setContent('<h4 class="health-check-comms-error">' + errorInfo.responseJSON.error + '</h4>');
                            return;
                        }

                        componentLayout.setContent('<h4 class="health-check-comms-error">Could not access Health Check Server</h4>');
                    }
                },
                paused: {
                    _onEnter: function() {
                        if (currentTimeout) {
                            clearTimeout(currentTimeout);
                        }
                    },
                    remove: function () {
                        this.transitionToState('uninitialised');
                    },
                    refreshComplete: function (data) {
                        success(data);
                    },
                    start: function() {
                        this.transitionToState('refreshing');
                    }
                },
                waiting: {
                    _onEnter: function (timeout) {
                        var internalMachine = this;

                        currentTimeout = setTimeout(function() {
                            internalMachine.transitionToState('refreshing');
                        }, timeout);
                    },
                    stop: function () {
                        this.transitionToState('paused');
                    }
                },
                refreshFailed: {
                    _onEnter: function (errorInfo) {
                        if (errorInfo && errorInfo.responseJSON && errorInfo.responseJSON.error) {
                            error(errorInfo.responseJSON.error);
                        }
                        else {
                            error('Cannot access health check server.');
                        }

                        this.transitionToState('waiting', 10000);
                    },
                    stop: function() {
                        this.transitionToState('paused');
                    }
                },
                refreshing: {
                    _onEnter: function () {
                        var internalMachine = this;

                        inlineLoading.loading();
                        
                        $.ajax({
                            url: refreshServerBaseUrl + configuration.serverSet,
                            success: function (data) {
                                stateMachine.handle('refreshComplete', data);
                            },
                            error: function(errorInfo) {
                                internalMachine.transitionToState('refreshFailed', errorInfo);
                            }
                        });
                    },
                    refreshComplete: function (data) {
                        serverList.updateStatus(data.groups);

                        lastUpdated.setLastUpdated(data.refreshedAt);

                        inlineLoading.finished();
                        inlineError.hide();
                        
                        this.transitionToState('waiting', calculateNextRefresh(data.nextRefreshAt));
                    },
                    stop: function () {
                        this.transitionToState('paused');
                    }
                }
            },
            initialState: 'uninitialised'
        });

        function error(errorMessage) {
            inlineError.show(errorMessage);
            inlineLoading.finished();
            lastUpdated.refreshText();
        }
        
        TLRGRP.messageBus.subscribe('TLRGRP.BADGER.PAGE.Hidden', function () {
            stateMachine.handle('stop');
        });

        TLRGRP.messageBus.subscribe('TLRGRP.BADGER.PAGE.Visible', function () {
            stateMachine.handle('start');
        });

        return {
            render: function (container) {
                return stateMachine.handle('initialise', container);
            },
            unload: function () {
                stateMachine.handle('stop');
                stateMachine.handle('remove');
            }
        };
    };
})();

