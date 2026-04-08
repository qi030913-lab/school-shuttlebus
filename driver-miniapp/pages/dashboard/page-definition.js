const { request } = require('../../common/request')
const { tencentMap } = require('../../config')
const { createDashboardLocationModule } = require('../../common/location')
const { createDashboardTestRouteModule } = require('../../common/testRoute')


const UPLOAD_THROTTLE_MS = 1000
// 测试数据1 北门到双体 线下演示
const TEST_START_LATITUDE = 36.244498
const TEST_START_LONGITUDE = 117.287531
const TEST_TARGET_LATITUDE = 36.241457
const TEST_TARGET_LONGITUDE = 117.291047

// 测试数据2 南门到育英 线上演示
// const TEST_START_LATITUDE = 36.239910
// const TEST_START_LONGITUDE = 117.287131
// const TEST_TARGET_LATITUDE = 36.239671
// const TEST_TARGET_LONGITUDE = 117.292507


const TEST_LOCATION_INTERVAL_MS = 1000
const TEST_ROUTE_SAMPLE_DISTANCE_METERS = 15
const TEST_ROUTE_DEFAULT_SPEED = Number(
  (TEST_ROUTE_SAMPLE_DISTANCE_METERS * 1000 / TEST_LOCATION_INTERVAL_MS).toFixed(2)
)
const TEST_MANUAL_ROUTE_POINTS = [
  [36.244498, 117.287531],
  [36.244512, 117.287902],
  [36.24452, 117.288318],
  [36.244498, 117.288796],
  [36.244255, 117.289248],
  [36.243846, 117.28964],
  [36.243343, 117.289987],
  [36.242787, 117.29033],
  [36.242214, 117.290618],
  [36.24176, 117.290874],
  [36.241457, 117.291047]
]
const TENCENT_MAP_DIRECTION_KEY = tencentMap.directionKey
const TENCENT_MAP_DIRECTION_MODES = ['driving', 'walking']

const TRIP_STATUS_IDLE = '\u672a\u53d1\u8f66'
const TRIP_STATUS_RUNNING = '\u8fd0\u884c\u4e2d'
const TRIP_STATUS_STOPPED = '\u5df2\u7ed3\u675f'

const MESSAGE_LOGIN_EXPIRED = '\u767b\u5f55\u6001\u5931\u6548\uff0c\u8bf7\u91cd\u65b0\u767b\u5f55'
const MESSAGE_NEED_LOCATION_PERMISSION = '\u9700\u8981\u5b9a\u4f4d\u6743\u9650'
const MESSAGE_NEED_LOCATION_PERMISSION_DESC = '\u53f8\u673a\u7aef\u9700\u8981\u83b7\u53d6\u5b9a\u4f4d\u540e\u624d\u80fd\u4e0a\u4f20\u8f66\u8f86\u4f4d\u7f6e\uff0c\u8bf7\u5148\u5f00\u542f\u5b9a\u4f4d\u6743\u9650\u3002'
const MESSAGE_GO_ENABLE = '\u53bb\u5f00\u542f'
const MESSAGE_CANCEL = '\u53d6\u6d88'
const MESSAGE_OPEN_SETTING_FAILED = '\u65e0\u6cd5\u6253\u5f00\u8bbe\u7f6e\u9875'
const MESSAGE_CHECK_PERMISSION_FAILED = '\u5b9a\u4f4d\u6743\u9650\u68c0\u67e5\u5931\u8d25'
const MESSAGE_LOCATION_PERMISSION_MISSING = '\u672a\u5f00\u542f\u5b9a\u4f4d\u6743\u9650'
const MESSAGE_ENABLE_GPS = '\u8bf7\u6253\u5f00\u624b\u673a\u5b9a\u4f4d\u670d\u52a1'
const MESSAGE_START_TRACKING_FAILED = '\u5f00\u542f\u6301\u7eed\u5b9a\u4f4d\u5931\u8d25'
const MESSAGE_FIRST_LOCATION_FAILED = '\u9996\u6b21\u5b9a\u4f4d\u5931\u8d25'
const MESSAGE_TRIP_STARTED = '\u5df2\u53d1\u8f66'
const MESSAGE_TRIP_STARTED_CHECK_LOCATION = '\u5df2\u53d1\u8f66\uff0c\u8bf7\u68c0\u67e5\u5b9a\u4f4d'
const MESSAGE_TRIP_START_FAILED = '\u53d1\u8f66\u5931\u8d25'
const MESSAGE_TRIP_STOPPED = '\u5df2\u7ed3\u675f\u53d1\u8f66'
const MESSAGE_TRIP_STOP_FAILED = '\u7ed3\u675f\u53d1\u8f66\u5931\u8d25'
const MESSAGE_LOCATION_FAILED = '\u5b9a\u4f4d\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5'
const MESSAGE_TEST_STOPPED = '\u6d4b\u8bd5\u5df2\u505c\u6b62'
const MESSAGE_TEST_ROUTE_PREPARING = '\u6d4b\u8bd5\u8def\u7ebf\u51c6\u5907\u4e2d'
const MESSAGE_PLANNING_ROUTE = '\u89c4\u5212\u8def\u7ebf\u4e2d'
const MESSAGE_BUILD_ROUTE_FAILED = '\u6d4b\u8bd5\u8def\u7ebf\u751f\u6210\u5931\u8d25'
const MESSAGE_REACHED_TARGET = '\u5df2\u5230\u8fbe\u6d4b\u8bd5\u7ec8\u70b9'
const MESSAGE_TEST_START_DEFAULT = '\u6d4b\u8bd5\u5df2\u5f00\u59cb'
const MESSAGE_TEST_START_DRIVING = '\u9a7e\u8f66\u8def\u7ebf\u6d4b\u8bd5\u4e2d'
const MESSAGE_TEST_START_WALKING = '\u6b65\u884c\u8def\u7ebf\u6d4b\u8bd5\u4e2d'
const MESSAGE_TEST_START_MANUAL = '\u9884\u8bbe\u8def\u7ebf\u6d4b\u8bd5\u4e2d'
const MESSAGE_TEST_START_FALLBACK = '\u76f4\u7ebf\u56de\u9000\u6d4b\u8bd5\u4e2d'
const MESSAGE_UPLOAD_SUCCESS = '\u4e0a\u62a5\u6210\u529f'
const MESSAGE_UPLOAD_FAILED = '\u4f4d\u7f6e\u4e0a\u62a5\u5931\u8d25'

const pageDefinition = {
  data: {
    driverName: '',
    vehicleId: '',
    routeId: '',
    routeName: '',
    tripStatus: TRIP_STATUS_IDLE,
    latitude: '--',
    longitude: '--',
    speed: '--',
    autoUpload: false,
    mockMode: false,
    testing: false,
    labels: {
      panelTitle: '\u53f8\u673a\u9762\u677f',
      driver: '\u53f8\u673a\uff1a',
      vehicle: '\u8f66\u8f86\uff1a',
      route: '\u7ebf\u8def\uff1a',
      loginMode: '\u767b\u5f55\u6a21\u5f0f\uff1a',
      mockMode: 'Mock \u6a21\u5f0f',
      realLogin: '\u5fae\u4fe1\u771f\u5b9e\u767b\u5f55',
      status: '\u72b6\u6001\uff1a',
      latitude: '\u7eac\u5ea6\uff1a',
      longitude: '\u7ecf\u5ea6\uff1a',
      speed: '\u901f\u5ea6\uff1a',
      startTrip: '\u5f00\u59cb\u53d1\u8f66',
      uploadOnce: '\u4e0a\u4f20\u4e00\u6b21\u4f4d\u7f6e',
      startAutoUpload: '\u5f00\u542f\u81ea\u52a8\u4e0a\u4f20',
      stopAutoUpload: '\u505c\u6b62\u81ea\u52a8\u4e0a\u4f20',
      startTestRoute: '\u5f00\u59cb\u6d4b\u8bd5\u8def\u7ebf',
      stopTest: '\u505c\u6b62\u6d4b\u8bd5',
      stopTrip: '\u7ed3\u675f\u53d1\u8f66',
      logout: '\u9000\u51fa\u767b\u5f55'
    }
  },

  async onLoad() {
    const driverInfo = wx.getStorageSync('driverInfo') || {}
    if (!driverInfo.loginToken) {
      wx.redirectTo({ url: '/pages/login/login' })
      return
    }

    this.setData({
      driverName: driverInfo.driverName || '',
      vehicleId: driverInfo.vehicleId || '',
      routeId: driverInfo.routeId || '',
      routeName: driverInfo.routeName || '',
      mockMode: !!driverInfo.mockMode
    })

    this.latestLocation = null
    this.pendingUploadLocation = null
    this.pendingUploadTimer = null
    this.uploading = false
    this.lastUploadAt = 0
    this.locationTrackingStarted = false
    this.locationChangeHandler = null
    this.testLocationTimer = null
    this.testLocationState = null
    this.testUploadRunning = false
    this.testRouteCache = null
    this.testRouteLoading = false

    try {
      const me = await request('/api/driver/me')
      this.setData({
        driverName: me.driverName || '',
        vehicleId: me.vehicleId || '',
        routeId: me.routeId || '',
        routeName: me.routeName || this.data.routeName
      })
      await this.restoreRuntimeState()
    } catch (e) {
      wx.showToast({ title: MESSAGE_LOGIN_EXPIRED, icon: 'none' })
      wx.removeStorageSync('driverInfo')
      wx.redirectTo({ url: '/pages/login/login' })
    }
  },

  onShow() {
    if (this.data.autoUpload && !this.locationTrackingStarted) {
      this.resumeAutoUploadAfterShow()
    }
  },

  onHide() {
  },

  onUnload() {
    this.stopTestLocationSimulation()
    this.stopAutoUploadInternal(false)
    this.stopLocationTracking()
  },

  async resumeAutoUploadAfterShow() {
    if (!this.data.autoUpload || this.locationTrackingStarted) {
      return
    }

    await this.enableAutoUpload({ showUploadToast: false })
  },

  clearPendingUploadTimer() {
    if (this.pendingUploadTimer) {
      clearTimeout(this.pendingUploadTimer)
      this.pendingUploadTimer = null
    }
  },

  clearTestLocationTimer() {
    if (this.testLocationTimer) {
      clearInterval(this.testLocationTimer)
      this.testLocationTimer = null
    }
  },

  stopTestLocationSimulation(showToast = false, message = '') {
    this.clearTestLocationTimer()
    this.testLocationState = null
    this.testUploadRunning = false

    if (this.data.testing) {
      this.setData({ testing: false })
    }

    if (showToast && message) {
      wx.showToast({ title: message, icon: 'none' })
    }
  },

  updateLocationPanel(location) {
    if (!location) {
      return
    }

    this.setData({
      latitude: Number(location.latitude).toFixed(6),
      longitude: Number(location.longitude).toFixed(6),
      speed: Number(location.speed || 0).toFixed(2)
    })
  },

  resetLocationPanel() {
    this.setData({
      latitude: '--',
      longitude: '--',
      speed: '--'
    })
  },

  async restoreRuntimeState() {
    if (!this.data.vehicleId) {
      this.setData({ tripStatus: TRIP_STATUS_IDLE })
      this.resetLocationPanel()
      return
    }

    try {
      const runtime = await request(`/api/user/vehicles/${encodeURIComponent(this.data.vehicleId)}`)
      if (!runtime || !runtime.vehicleId) {
        this.setData({ tripStatus: TRIP_STATUS_IDLE })
        this.resetLocationPanel()
        return
      }

      const hasLocation = runtime.latitude !== null
        && runtime.latitude !== undefined
        && runtime.longitude !== null
        && runtime.longitude !== undefined

      if (hasLocation) {
        const location = this.normalizeLocation({
          latitude: runtime.latitude,
          longitude: runtime.longitude,
          speed: runtime.speed || 0
        })
        this.latestLocation = location
        this.updateLocationPanel(location)
      } else {
        this.latestLocation = null
        this.resetLocationPanel()
      }

      this.setData({
        tripStatus: runtime.status === 'RUNNING' ? TRIP_STATUS_RUNNING : TRIP_STATUS_STOPPED,
        routeId: runtime.routeId || this.data.routeId,
        routeName: runtime.routeName || this.data.routeName
      })
    } catch (e) {
      this.latestLocation = null
      this.setData({ tripStatus: TRIP_STATUS_IDLE })
      this.resetLocationPanel()
    }
  },

  stopAutoUploadInternal(showToast, message = '') {
    this.clearPendingUploadTimer()
    this.pendingUploadLocation = null

    if (this.data.autoUpload) {
      this.setData({ autoUpload: false })
    }

    if (showToast && message) {
      wx.showToast({ title: message, icon: 'none' })
    }
  },

  async enableAutoUpload({ showUploadToast = true } = {}) {
    this.stopTestLocationSimulation()

    const trackingReady = await this.startLocationTracking()
    if (!trackingReady) {
      return false
    }

    if (!this.data.autoUpload) {
      this.setData({ autoUpload: true })
    }

    if (this.latestLocation) {
      const success = await this.enqueueUpload(this.latestLocation, true, !showUploadToast)
      if (!success) {
        this.stopLocationTracking()
      }
      return success
    }

    try {
      const location = this.normalizeLocation(await this.getLocation())
      this.latestLocation = location
      this.updateLocationPanel(location)
      const success = await this.enqueueUpload(location, true, !showUploadToast)
      if (!success) {
        this.stopLocationTracking()
      }
      return success
    } catch (e) {
      this.stopAutoUploadInternal(true, MESSAGE_FIRST_LOCATION_FAILED)
      this.stopLocationTracking()
      return false
    }
  },

  async startTrip() {
    try {
      this.stopTestLocationSimulation()
      await request('/api/driver/start', 'POST', {})
      this.setData({ tripStatus: TRIP_STATUS_RUNNING })
      const autoUploadReady = await this.enableAutoUpload({ showUploadToast: false })
      wx.showToast({
        title: autoUploadReady ? MESSAGE_TRIP_STARTED : MESSAGE_TRIP_STARTED_CHECK_LOCATION,
        icon: autoUploadReady ? 'success' : 'none'
      })
    } catch (e) {
      wx.showToast({ title: e.message || e.msg || MESSAGE_TRIP_START_FAILED, icon: 'none' })
    }
  },

  async finishTrip({ logoutAfterStop = false } = {}) {
    try {
      this.stopTestLocationSimulation()
      await request('/api/driver/stop', 'POST', {})
      this.stopAutoUploadInternal(false)
      this.stopLocationTracking()
      this.latestLocation = null
      this.resetLocationPanel()
      this.setData({ tripStatus: TRIP_STATUS_STOPPED })

      if (logoutAfterStop) {
        wx.removeStorageSync('driverInfo')
        wx.redirectTo({ url: '/pages/login/login' })
        return true
      }

      wx.showToast({ title: MESSAGE_TRIP_STOPPED, icon: 'success' })
      return true
    } catch (e) {
      wx.showToast({ title: e.message || e.msg || MESSAGE_TRIP_STOP_FAILED, icon: 'none' })
      return false
    }
  },

  async stopTrip() {
    await this.finishTrip()
  },

  async uploadOnce() {
    this.stopTestLocationSimulation()

    const hasPermission = await this.ensureLocationPermission()
    if (!hasPermission) {
      wx.showToast({ title: MESSAGE_LOCATION_PERMISSION_MISSING, icon: 'none' })
      return
    }

    try {
      const location = this.normalizeLocation(await this.getLocation())
      this.latestLocation = location
      this.updateLocationPanel(location)
      await this.uploadLocation(location, false)
    } catch (e) {
      const errMsg = e && e.errMsg ? e.errMsg : ''
      if (this.isLocationServiceError(errMsg)) {
        wx.showToast({ title: MESSAGE_ENABLE_GPS, icon: 'none' })
        return
      }
      wx.showToast({ title: MESSAGE_LOCATION_FAILED, icon: 'none' })
    }
  },

  async toggleAutoUpload() {
    if (this.data.autoUpload) {
      this.stopAutoUploadInternal(false)
      this.stopLocationTracking()
      return
    }

    await this.enableAutoUpload({ showUploadToast: true })
  },

  async toggleTestLocation() {
    if (this.data.testing) {
      this.stopTestLocationSimulation(true, MESSAGE_TEST_STOPPED)
      return
    }

    if (this.testRouteLoading) {
      wx.showToast({ title: MESSAGE_TEST_ROUTE_PREPARING, icon: 'none' })
      return
    }

    this.stopAutoUploadInternal(false)
    this.stopLocationTracking()
    this.testLocationState = null
    this.testRouteLoading = true

    let routePlan = null
    wx.showLoading({
      title: MESSAGE_PLANNING_ROUTE,
      mask: true
    })

    try {
      routePlan = await this.ensurePlannedTestRouteLocations()
    } finally {
      this.testRouteLoading = false
      wx.hideLoading()
    }

    if (!routePlan || !Array.isArray(routePlan.routeLocations) || !routePlan.routeLocations.length) {
      wx.showToast({ title: MESSAGE_BUILD_ROUTE_FAILED, icon: 'none' })
      return
    }

    this.testLocationState = {
      routeLocations: routePlan.routeLocations,
      currentStep: 0
    }

    const firstLocation = this.buildTestLocation(false)
    this.latestLocation = firstLocation
    this.updateLocationPanel(firstLocation)
    this.setData({ testing: true })

    const firstUploadSuccess = await this.uploadLocation(firstLocation, true)
    if (!firstUploadSuccess) {
      this.stopTestLocationSimulation()
      return
    }

    this.testLocationTimer = setInterval(async () => {
      if (!this.data.testing || this.testUploadRunning) {
        return
      }

      this.testUploadRunning = true

      try {
        const nextLocation = this.buildTestLocation(true)
        this.latestLocation = nextLocation
        this.updateLocationPanel(nextLocation)

        const success = await this.uploadLocation(nextLocation, true)
        if (!success) {
          this.stopTestLocationSimulation(true, MESSAGE_TEST_STOPPED)
          return
        }

        if (this.hasReachedTestTarget()) {
          this.stopTestLocationSimulation(true, MESSAGE_REACHED_TARGET)
        }
      } finally {
        this.testUploadRunning = false
      }
    }, TEST_LOCATION_INTERVAL_MS)

    const startMessageMap = {
      driving: MESSAGE_TEST_START_DRIVING,
      walking: MESSAGE_TEST_START_WALKING,
      manual: MESSAGE_TEST_START_MANUAL,
      fallback: MESSAGE_TEST_START_FALLBACK
    }

    wx.showToast({
      title: startMessageMap[routePlan.mode] || MESSAGE_TEST_START_DEFAULT,
      icon: 'success'
    })
  },

  enqueueUpload(location, force, silent) {
    if (!location) {
      return Promise.resolve(false)
    }

    this.latestLocation = location

    if (this.uploading) {
      this.pendingUploadLocation = location
      return Promise.resolve(true)
    }

    const elapsed = Date.now() - this.lastUploadAt
    if (!force && elapsed < UPLOAD_THROTTLE_MS) {
      this.pendingUploadLocation = location
      const waitMs = UPLOAD_THROTTLE_MS - elapsed

      if (!this.pendingUploadTimer) {
        this.pendingUploadTimer = setTimeout(() => {
          this.pendingUploadTimer = null
          const nextLocation = this.pendingUploadLocation
          this.pendingUploadLocation = null
          if (this.data.autoUpload && nextLocation) {
            this.enqueueUpload(nextLocation, true, true)
          }
        }, waitMs)
      }

      return Promise.resolve(true)
    }

    return this.uploadLocation(location, silent)
  },

  async uploadLocation(location, silent) {
    this.uploading = true
    this.lastUploadAt = Date.now()

    try {
      const result = await request('/api/driver/location', 'POST', {
        latitude: location.latitude,
        longitude: location.longitude,
        speed: location.speed || 0
      })

      this.updateLocationPanel(location)
      this.setData({
        tripStatus: result.status === 'RUNNING' ? TRIP_STATUS_RUNNING : TRIP_STATUS_STOPPED
      })

      if (!silent) {
        wx.showToast({ title: MESSAGE_UPLOAD_SUCCESS, icon: 'success' })
      }
      return true
    } catch (e) {
      const msg = e && e.message ? e.message : (e && e.msg ? e.msg : MESSAGE_UPLOAD_FAILED)
      if (this.data.autoUpload) {
        this.stopAutoUploadInternal(true, msg)
        this.stopLocationTracking()
      } else {
        wx.showToast({ title: msg, icon: 'none' })
      }
      return false
    } finally {
      this.uploading = false

      if (this.data.autoUpload && this.pendingUploadLocation && !this.pendingUploadTimer) {
        const nextLocation = this.pendingUploadLocation
        this.pendingUploadLocation = null
        const waitMs = Math.max(0, UPLOAD_THROTTLE_MS - (Date.now() - this.lastUploadAt))
        this.pendingUploadTimer = setTimeout(() => {
          this.pendingUploadTimer = null
          if (this.data.autoUpload && nextLocation) {
            this.enqueueUpload(nextLocation, true, true)
          }
        }, waitMs)
      }
    }
  },

  async logout() {
    await this.finishTrip({ logoutAfterStop: true })
  }
}

const locationModule = createDashboardLocationModule({
  needLocationPermission: MESSAGE_NEED_LOCATION_PERMISSION,
  needLocationPermissionDesc: MESSAGE_NEED_LOCATION_PERMISSION_DESC,
  goEnable: MESSAGE_GO_ENABLE,
  cancel: MESSAGE_CANCEL,
  openSettingFailed: MESSAGE_OPEN_SETTING_FAILED,
  checkPermissionFailed: MESSAGE_CHECK_PERMISSION_FAILED,
  locationPermissionMissing: MESSAGE_LOCATION_PERMISSION_MISSING,
  enableGps: MESSAGE_ENABLE_GPS,
  startTrackingFailed: MESSAGE_START_TRACKING_FAILED
})

const testRouteModule = createDashboardTestRouteModule({
  testStartLatitude: TEST_START_LATITUDE,
  testStartLongitude: TEST_START_LONGITUDE,
  testTargetLatitude: TEST_TARGET_LATITUDE,
  testTargetLongitude: TEST_TARGET_LONGITUDE,
  testLocationIntervalMs: TEST_LOCATION_INTERVAL_MS,
  testRouteDefaultSpeed: TEST_ROUTE_DEFAULT_SPEED,
  testRouteSampleDistanceMeters: TEST_ROUTE_SAMPLE_DISTANCE_METERS,
  testManualRoutePoints: TEST_MANUAL_ROUTE_POINTS,
  tencentMapDirectionKey: TENCENT_MAP_DIRECTION_KEY,
  tencentMapDirectionModes: TENCENT_MAP_DIRECTION_MODES
})

module.exports = Object.assign({}, pageDefinition, locationModule, testRouteModule)
