const socketModule = require('../../common/socket')
const locationModule = require('../../common/location')
const pageHelpers = require('../../common/pageHelpers')
const overviewModule = require('../../common/indexOverview')
const vehiclePresentationModule = require('../../common/indexVehiclePresentation')
const indexMapModule = require('../../common/indexMap')

const VEHICLE_MAP_ID = 'vehicleMap'
const POLL_INTERVAL_MS = 15000
const SOCKET_RETRY_BASE_MS = 2000
const SOCKET_RETRY_MAX_MS = 15000
const DEFAULT_USER_LOCATION = Object.freeze({
  latitude: 36.239600,
  longitude: 117.292518
})
const DEFAULT_USER_LOCATION_TEXT = '当前按默认位置显示你与车辆的距离'

const pageDefinition = {
  data: {
    routes: [],
    routeIndex: 0,
    currentRouteId: '',
    routeName: '',
    routeServiceTime: '',
    routeProgressWidth: '72%',
    vehicles: [],
    mapLatitude: DEFAULT_USER_LOCATION.latitude,
    mapLongitude: DEFAULT_USER_LOCATION.longitude,
    markers: [],
    polyline: [],
    refreshing: false,
    userLocationText: DEFAULT_USER_LOCATION_TEXT
  },

  logLocationDebug() {
  },

  getRuntimeInfo() {
    if (typeof wx.getSystemInfoSync !== 'function') {
      return {
        platform: 'unknown'
      }
    }

    try {
      const systemInfo = wx.getSystemInfoSync()
      return {
        platform: systemInfo.platform || 'unknown',
        host: systemInfo.host || '',
        brand: systemInfo.brand || '',
        model: systemInfo.model || '',
        system: systemInfo.system || ''
      }
    } catch (error) {
      this.logLocationDebug('wx.getSystemInfoSync.fail', this.toDebugError(error))
      return {
        platform: 'unknown'
      }
    }
  },

  isDevtoolsPlatform() {
    return !!(this.runtimeInfo && this.runtimeInfo.platform === 'devtools')
  },

  isAndroidPlatform() {
    return !!(this.runtimeInfo && this.runtimeInfo.platform === 'android')
  },

  getDefaultUserLocation() {
    return {
      latitude: DEFAULT_USER_LOCATION.latitude,
      longitude: DEFAULT_USER_LOCATION.longitude
    }
  },

  applyDefaultUserLocation(reason = '') {
    const defaultLocation = this.getDefaultUserLocation()

    if (reason) {
      this.logLocationDebug('use-default-user-location', {
        reason,
        latitude: defaultLocation.latitude,
        longitude: defaultLocation.longitude
      })
    }

    this.userLocation = defaultLocation
    this.setData({
      userLocationText: DEFAULT_USER_LOCATION_TEXT
    })
    this.refreshVehiclePresentation()
  },

  getInvalidLocationFeedback(error) {
    const isInvalidLocation = error && error.message === 'invalid-user-location'

    if (!isInvalidLocation) {
      return {
        userLocationText: '获取定位失败，暂不显示你与车辆的距离',
        toastTitle: '获取你的定位失败'
      }
    }

    if (this.isDevtoolsPlatform()) {
      return {
        userLocationText: '开发者工具返回的定位坐标异常，请检查位置模拟设置',
        toastTitle: '请检查位置模拟'
      }
    }

    return {
      userLocationText: '定位坐标异常，暂不显示你与车辆的距离',
      toastTitle: '定位坐标异常'
    }
  },

  toDebugError(error) {
    if (!error) {
      return null
    }

    return {
      errMsg: error.errMsg || '',
      errno: error.errno,
      code: error.code,
      message: error.message,
      stack: error.stack
    }
  },

  async onLoad() {
    this.mapContext = null
    this.socketTask = null
    this.socketReconnectTimer = null
    this.socketClosedByUser = false
    this.socketRetryCount = 0
    this.socketRetryBaseMs = SOCKET_RETRY_BASE_MS
    this.socketRetryMaxMs = SOCKET_RETRY_MAX_MS
    this.vehicleMarkerAnimationTimer = null
    this.vehicleMarkerDataSyncTimer = null
    this.vehicleMarkerDataSyncVersion = 0
    this.shouldResetMapCenter = true
    this.userLocation = this.getDefaultUserLocation()
    this.latestVehiclesRaw = []
    this.vehicleMarkers = []
    this.vehicleMotionMap = {}
    this.lastVehicleMarkerChangeAt = 0
    this.locationPollTimer = null
    this.locationPollIntervalMs = POLL_INTERVAL_MS
    this.runtimeInfo = this.getRuntimeInfo()

    this.logLocationDebug('runtime-info', this.runtimeInfo)

    await this.refreshUserLocation(true)
    await this.loadRoutes()
    this.connectSocket()

    this.pollTimer = setInterval(() => {
      this.loadOverview(false)
    }, POLL_INTERVAL_MS)

    this.startLocationPolling()
  },

  onReady() {
    this.ensureMapContext()
  },

  onUnload() {
    this.clearVehicleMarkerAnimation()
    this.clearVehicleMarkerDataSyncTimer()
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    if (this.locationPollTimer) {
      clearInterval(this.locationPollTimer)
      this.locationPollTimer = null
    }
    this.clearSocketReconnectTimer()
    this.socketClosedByUser = true
    if (this.socketTask) {
      this.socketTask.close()
      this.socketTask = null
    }
    this.vehicleMarkers = []
    this.vehicleMotionMap = {}
  },

  filterSocketVehicles(vehicles) {
    return vehicles.filter(item => !this.data.currentRouteId || item.routeId === this.data.currentRouteId)
  },

  handleSocketVehicles(vehicles) {
    this.applyVehicles(vehicles)
  },

  handleSocketParseError() {
  },

  ensureMapContext() {
    if (this.mapContext || typeof wx.createMapContext !== 'function') {
      return this.mapContext
    }

    try {
      this.mapContext = wx.createMapContext(VEHICLE_MAP_ID, this)
    } catch (error) {
      this.logLocationDebug('wx.createMapContext.fail', this.toDebugError(error))
      this.mapContext = null
    }

    return this.mapContext
  },

  setSocketStatus(status) {
    this.socketStatus = status || 'disconnected'
  },

  goToVehicleDetail(e) {
    const { vehicleId } = e.currentTarget.dataset || {}
    if (!vehicleId) {
      return
    }

    const query = [
      `vehicleId=${encodeURIComponent(vehicleId)}`,
      `routeId=${encodeURIComponent(this.data.currentRouteId || '')}`,
      `routeName=${encodeURIComponent(this.data.routeName || '')}`,
      `serviceTime=${encodeURIComponent(this.data.routeServiceTime || '')}`
    ].join('&')

    wx.navigateTo({
      url: `/pages/vehicles/index?${query}`
    })
  }
}

module.exports = Object.assign(
  {},
  pageDefinition,
  socketModule,
  locationModule,
  pageHelpers,
  overviewModule,
  vehiclePresentationModule,
  indexMapModule
)
