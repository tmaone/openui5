/*!
 * ${copyright}
 */

sap.ui.define([
	"sap/ui/base/ManagedObjectObserver",
	"sap/ui/core/util/reflection/JsControlTreeModifier",
	"sap/base/util/each"
], function(
	ManagedObjectObserver,
	JsControlTreeModifier,
	each
) {
	"use strict";

	/**
	 * Object to register extension points to track their locations
	 * @constructor
	 * @alias sap.ui.fl.registry.ExtensionPointRegistry
	 *
	 * @author SAP SE
	 * @version ${version}
	 *
	 * @private
	 * @ui5-restricted sap.ui.fl
	 */
	var ExtensionPointRegistry = function() {
		this._bEnabledObserver = sap.ui.getCore().getConfiguration().getDesignMode();
		this._mObservers = {};
		this._mExtensionPointsByParent = {};
		this._mExtensionPointsByViewId = {};
	};

	ExtensionPointRegistry._instance = undefined;

	/**
	 * Returns the singleton instance of the extension point registry.
	 *
	 * @returns {sap.ui.fl.registry.ExtensionPointRegistry} Instance (singleton) of the extension point registry
	 */
	ExtensionPointRegistry.getInstance = function() {
		if (!ExtensionPointRegistry._instance) {
			ExtensionPointRegistry._instance = new ExtensionPointRegistry();
		}
		return ExtensionPointRegistry._instance;
	};

	/**
	 * Returns a map containing an array with extension point names and their indices sorted by their appearance for
	 * each aggregation of a given parent control id.
	 *
	 * @param {string} sParentId - Parent control id.
	 * @returns {object} mAggregations - Map of aggregations with information about the order of the containing extension points.
	 */
	ExtensionPointRegistry.prototype._spotExtensionPointsInAggregation = function(sParentId) {
		var mAggregations = {};
		each(this._mExtensionPointsByParent[sParentId], function(sExtensionPointName, oExtensionPoint) {
			if (!mAggregations[oExtensionPoint.aggregationName]) {
				mAggregations[oExtensionPoint.aggregationName] = [];
			}
			mAggregations[oExtensionPoint.aggregationName].push({
				name: sExtensionPointName,
				index: oExtensionPoint.index
			});
			mAggregations[oExtensionPoint.aggregationName].sort(function(o1, o2) {
				return o1.index - o2.index;
			});
		});

		return mAggregations;
	};

	ExtensionPointRegistry.prototype._observeIndex = function(oEvent) {
		var sParentId = oEvent.object.getId();
		var mAggregations = this._spotExtensionPointsInAggregation(sParentId);
		var sAggregationName;
		var iOffset;

		each(this._mExtensionPointsByParent[sParentId], function(sExtensionPointName, oExtensionPoint) {
			sAggregationName = oExtensionPoint.aggregationName;
			if (sAggregationName === oEvent.name) {
				// Internally the XML nodes of an aggregation are used where the extension points are available. This
				// registry works with JS controls, therefore an offset is needed for each additional extension point
				// which is located before the monitored extension point (multiple extension points in one aggregation).
				iOffset = 0;
				mAggregations[sAggregationName].some(function(oExtensionPointLocation, index) {
					iOffset = index;
					return oExtensionPointLocation.name === sExtensionPointName;
				});

				var aControlIds = JsControlTreeModifier.getAggregation(oEvent.object, sAggregationName).map(function(oControl) {
					return oControl.getId();
				});

				if (oEvent.mutation === "insert") {
					if (aControlIds.indexOf(oEvent.child.getId()) < oExtensionPoint.index - iOffset) {
						oExtensionPoint.index++;
					}
				} else {
					if (oExtensionPoint.aggregation.indexOf(oEvent.child.getId()) < oExtensionPoint.index - iOffset) {
						oExtensionPoint.index--;
					}
				}

				oExtensionPoint.aggregation = aControlIds;
			}
		});
	};

	ExtensionPointRegistry.prototype._startObserver = function (oParent, sAggregationName) {
		if (this._bEnabledObserver) {
			var sParentId = oParent.getId();
			if (!this._mObservers[sParentId]) {
				var oObserver = new ManagedObjectObserver(this._observeIndex.bind(this));
				oObserver.observe(oParent, {
					aggregations: [sAggregationName]
				});
				this._mObservers[sParentId] = {
					observer: oObserver,
					aggregations: [sAggregationName]
				};
			} else {
				var bIsObserved = this._mObservers[sParentId].observer.isObserved(oParent, {aggregations: [sAggregationName]});
				if (!bIsObserved) {
					this._mObservers[sParentId].aggregations.push(sAggregationName);
					this._mObservers[sParentId].observer.observe(oParent, {
						aggregations: this._mObservers[sParentId].aggregations
					});
				}
			}
		}
	};

	/**
	 * Registration of extension points for observing the aggregation to track the index.
	 *
	 * @param {object} mExtensionPointInfo - Map of extension point information
	 * @param {object} mExtensionPointInfo.view - View object
	 * @param {string} mExtensionPointInfo.name - Name of the extension point
	 * @param {object} mExtensionPointInfo.targetControl - Parent control of the extension point
	 * @param {string} mExtensionPointInfo.aggregationName - Name of the aggregation where the extension point is
	 * @param {number} mExtensionPointInfo.index - Index of the extension point
	 */
	ExtensionPointRegistry.prototype.registerExtensionPoints = function(mExtensionPointInfo) {
		var oParent = mExtensionPointInfo.targetControl;
		var sViewId = mExtensionPointInfo.view.getId();
		var sAggregationName = mExtensionPointInfo.aggregationName;
		this._startObserver(oParent, sAggregationName);

		var aControlIds = (JsControlTreeModifier.getAggregation(oParent, sAggregationName) || []).map(function(oControl) {
			return oControl.getId();
		});

		var sParentId = oParent.getId();
		if (!this._mExtensionPointsByParent[sParentId]) {
			this._mExtensionPointsByParent[sParentId] = {};
		}
		if (!this._mExtensionPointsByViewId[sViewId]) {
			this._mExtensionPointsByViewId[sViewId] = {};
		}
		mExtensionPointInfo.aggregation = aControlIds;
		this._mExtensionPointsByParent[sParentId][mExtensionPointInfo.name] = mExtensionPointInfo;
		this._mExtensionPointsByViewId[sViewId][mExtensionPointInfo.name] = mExtensionPointInfo;
	};

	/**
	 * Returns the extension point information.
	 *
	 * @param {string} sExtensionPointName - Name of the extension point
	 * @param {object} oView - View object
	 * @returns {object} mExtensionPointInfo - Map of extension point information
	 */
	ExtensionPointRegistry.prototype.getExtensionPointInfo = function (sExtensionPointName, oView) {
		return this._mExtensionPointsByViewId[oView.getId()]
			&& this._mExtensionPointsByViewId[oView.getId()][sExtensionPointName];
	};

	/**
	 * Destroys the registered observers and initializes the registry.
	 */
	ExtensionPointRegistry.prototype.exit = function() {
		Object.keys(this._mObservers).forEach(function(sParentId) {
			this._mObservers[sParentId].observer.disconnect();
			this._mObservers[sParentId].observer.destroy();
		}.bind(this));
		this._mObservers = {};
		this._mExtensionPointsByParent = {};
		this._mExtensionPointsByViewId = {};
		ExtensionPointRegistry._instance = undefined;
	};

	return ExtensionPointRegistry;
}, true);