/*******************************************************************************
 * @license
 * Copyright (c) 2011 IBM Corporation and others.
 * All rights reserved. This program and the accompanying materials are made 
 * available under the terms of the Eclipse Public License v1.0 
 * (http://www.eclipse.org/legal/epl-v10.html), and the Eclipse Distribution 
 * License v1.0 (http://www.eclipse.org/org/documents/edl-v10.html). 
 *
 * Contributors:
 *     IBM Corporation - initial API and implementation
 *******************************************************************************/
 /*globals define console setTimeout*/
define(["orion/auth", "orion/Deferred"], function(mAuth, Deferred){
	
	function _doServiceCall(operationsService, funcName, funcArgs) {
		var clientDeferred = new Deferred();
		operationsService[funcName].apply(operationsService, funcArgs).then(
			//on success, just forward the result to the client
			function(result) {
				clientDeferred.resolve(result);
			},
			//on failure we might need to retry
			function(error) {
				if (error.status === 401) {
					mAuth.handleAuthenticationError(error, function(message) {
						//try again
						operationsService[funcName].apply(operationsService, funcArgs).then(
							function(result) {
								clientDeferred.resolve(result);
							},
							function(error) {
								clientDeferred.reject(error);
							}
						);
					});
				} else {
					//forward other errors to client
					clientDeferred.reject(error);
				}
			}
		);
		return clientDeferred;
	}
	
	function _getOperations(operationsService, options){
		return _doServiceCall(operationsService, "getOperations", [options]);
	}
	
	function NoMatchingOperationsClient(location){
		this._location = location;
	}
	
	function returnNoMatchingError(){
		var result = new Deferred();
		result.reject("No Matching OperationService for location:" + this._location);
		return result;
	}
	
	NoMatchingOperationsClient.prototype = {
			getOperation: returnNoMatchingError,
			getOperations: returnNoMatchingError,
			removeCompletedOperations: returnNoMatchingError,
			removeOperation: returnNoMatchingError,
			cancelOperation: returnNoMatchingError
	};
	
	NoMatchingOperationsClient.prototype.constructor = NoMatchingOperationsClient;
	
	function OperationsClient(serviceRegistry){
		this._services = [];
		this._patterns = [];
		this._operationListeners = [];
		this._currentLongpollingIds = [];
		var operationsServices = serviceRegistry.getServiceReferences("orion.core.operation");
		for(var i=0; i<operationsServices.length; i++){
			var servicePtr = operationsServices[i];
			var operationsService = serviceRegistry.getService(servicePtr);
			this._services[i] = operationsService;
			
			var patternString = operationsServices[i].getProperty("pattern") || ".*";
			if (patternString[0] !== "^") {
				patternString = "^" + patternString;
			}
			this._patterns[i] = new RegExp(patternString);
		}
		
		this._getService = function(location) {
			if (!location) {
				return this._services[0];
			}
			for(var i = 0; i < this._patterns.length; ++i) {
				if (this._patterns[i].test(location)) {
					return this._services[i];
				}
			}
			return new NoMatchingOperationsClient(location);
		};
	}
	
	function _mergeOperations(lists){
		var result = {Children: []};
		for(var i=0; i < lists.length; i++){
			result.Children = result.Children.concat(lists[i].Children);
		}
		return result;
	}
	
	//TODO this is unused can we delete it?
//	function _registerOperationChangeListener(service, listener, longpollingId){
//		var that = this;
//		var args = {Longpolling: true};
//		if(longpollingId){
//			args.LongpollingId = longpollingId;
//		}
//		_doServiceCall(service, "getOperations", [args]).then(function(result){
//			if(longpollingId && that._currentLongpollingIds.indexOf(longpollingId)<0){
//				return;
//			}
//			listener(result, longpollingId);
//			if(result.LongpollingId){
//				that._currentLongpollingIds.push(result.LongpollingId);
//				_registerOperationChangeListener.bind(that)(service, listener, result.LongpollingId);
//			} else {
//				_registerOperationChangeListener.bind(that)(service, listener, longpollingId);
//			}
//			
//		}, function(error){
//			if(longpollingId && that._currentLongpollingIds.indexOf(longpollingId)<0){
//				return;
//			}
//			if("timeout"===error.dojoType) {
//				_registerOperationChangeListener.bind(that)(service, listener, longpollingId);
//			} else {
//				setTimeout(function(){_registerOperationChangeListener.bind(that)(service, listener, longpollingId);}, 2000); //TODO display error and ask user to retry rather than retry every 2 sec
//			}
//		});
//	}
	
	function _notifyChangeListeners(result){
		for(var i=0; i<this._operationListeners.length; i++){
			this._operationListeners[i](result);
		}
	}
	
	OperationsClient.prototype = {
			getOperations: function(){
				var result = new Deferred();
				var results = [];

				for(var i=0; i<this._services.length; i++){
					results[i] = _getOperations(this._services[i]);
				}
				new Deferred().all(results).then(function(lists){
					result.resolve(_mergeOperations(lists));
				});
				return result;
			},
			getRunningOperations: function(){
				var result = new Deferred();
				var results = [];

				for(var i=0; i<this._services.length; i++){
					results[i] = _getOperations(this._services[i], {RunningOnly: true});
				}
				new Deferred().all(results).then(function(lists){
					result.resolve(_mergeOperations(lists));
				});
				return result;
			},
			getOperation: function(operationLocation){
				return _doServiceCall(this._getService(operationLocation), "getOperation", arguments);
			},
			removeCompletedOperations: function(){
				var results = [];
				for(var i=0; i<this._services.length; i++){
					results[i] = _doServiceCall(this._services[i], "removeCompletedOperations");
				}
				return new Deferred().all(results);
			},
			
			removeOperation: function(operationLocation){
				return _doServiceCall(this._getService(operationLocation), "removeOperation", arguments);
			},
			
			cancelOperation: function(operationLocation){
				return _doServiceCall(this._getService(operationLocation), "cancelOperation", arguments);
			},
	
			addOperationChangeListener: function(listener){
				this._operationListeners.push(listener);
				if(this._operationListeners.length===1){
					if(this._services.length<1){
						throw "No operations services registered.";
					}
					for(var i=0; i<this._services.length; i++){
						this._registerOperationChangeListener(this._services[i], _notifyChangeListeners.bind(this));
					}
				}
			},
			
			removeOperationChangeListener: function(listener){
				for(var i=0; i<this._operationListeners.length; i++){
					if(this._operationListeners[i]===listener){
						this._operationListeners.splice(i, 1);
						break;
					}
				}
				if(this._operationListeners.length===0){
					//stop listening if no listeners registered
					this._currentLongpollingIds = [];
				}
			},
			
			resetChangeListeners: function(){
				this._currentLongpollingIds = [];
				if(this._services.length<1){
					throw "No operations services registered.";
				}
				for(var i=0; i<this._services.length; i++){
					this._registerOperationChangeListener(this._services[i], _notifyChangeListeners.bind(this));
				}
			}
	};
	
	OperationsClient.prototype.constructor = OperationsClient;
	
	return {OperationsClient: OperationsClient};
});