const { request } = require('../../utils')

const UPLOAD_THROTTLE_MS = 5000
const TEST_START_LATITUDE = 36.239980176264595
const TEST_START_LONGITUDE = 117.28365907055604
const TEST_LOCATION_STEP = 0.0001
const TEST_LOCATION_INTERVAL_MS = 1000
const TRIP_STATUS_IDLE = '未发车'
const TRIP_STATUS_RUNNING = '运行中'
const TRIP_STATUS_STOPPED = '已结束'

Page({
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
    testing: false
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

    try {
      const me = await request('/api/driver/me')
      this.setData({
        driverName: me.driverName || '',
        vehicleId: me.vehicleId || '',
        routeId: me.routeId || ''
      })
      await this.restoreRuntimeState()
    } catch (e) {
      wx.showToast({ title: '登录态失效，请重新登录', icon: 'none' })
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

  getSetting() {
    return new Promise((resolve, reject) => {
      wx.getSetting({
        success: resolve,
        fail: reject
      })
    })
  },

  authorizeLocation() {
    return new Promise((resolve, reject) => {
      wx.authorize({
        scope: 'scope.userLocation',
        success: resolve,
        fail: reject
      })
    })
  },

  openSetting() {
    return new Promise((resolve, reject) => {
      wx.openSetting({
        success: resolve,
        fail: reject
      })
    })
  },

  showLocationPermissionModal() {
    return new Promise(resolve => {
      wx.showModal({
        title: '需要定位权限',
        content: '司机端需要获取定位后才能上传车辆位置，请先开启定位权限。',
        confirmText: '去开启',
        cancelText: '取消',
        success: resolve,
        fail: () => resolve({ confirm: false, cancel: true })
      })
    })
  },

  getLocation() {
    return new Promise((resolve, reject) => {
      wx.getLocation({
        type: 'gcj02',
        success: resolve,
        fail: reject
      })
    })
  },

  startLocationUpdate() {
    return new Promise((resolve, reject) => {
      wx.startLocationUpdate({
        success: resolve,
        fail: reject
      })
    })
  },

  stopLocationUpdate() {
    return new Promise(resolve => {
      if (!wx.stopLocationUpdate) {
        resolve()
        return
      }

      wx.stopLocationUpdate({
        success: resolve,
        fail: () => resolve()
      })
    })
  },

  startLocationUpdateBackground() {
    return new Promise((resolve, reject) => {
      if (!wx.startLocationUpdateBackground) {
        reject(new Error('background-api-unavailable'))
        return
      }

      wx.startLocationUpdateBackground({
        success: resolve,
        fail: reject
      })
    })
  },

  async openLocationSetting() {
    const modalRes = await this.showLocationPermissionModal()
    if (!modalRes.confirm) {
      return false
    }

    try {
      const settingRes = await this.openSetting()
      return !!(settingRes.authSetting && settingRes.authSetting['scope.userLocation'])
    } catch (e) {
      wx.showToast({ title: '无法打开设置页', icon: 'none' })
      return false
    }
  },

  async ensureLocationPermission() {
    try {
      const settingRes = await this.getSetting()
      const locationAuthorized = settingRes.authSetting && settingRes.authSetting['scope.userLocation']

      if (locationAuthorized === true) {
        return true
      }

      if (locationAuthorized !== false) {
        try {
          await this.authorizeLocation()
          return true
        } catch (e) {
          return this.openLocationSetting()
        }
      }

      return this.openLocationSetting()
    } catch (e) {
      wx.showToast({ title: '定位权限检查失败', icon: 'none' })
      return false
    }
  },

  isLocationServiceError(errMsg = '') {
    const text = String(errMsg).toLowerCase()
    return text.includes('system permission denied')
      || text.includes('locationswitchoff')
      || text.includes('location service disabled')
      || text.includes('no such provider')
  },

  normalizeLocation(res) {
    return {
      latitude: res.latitude,
      longitude: res.longitude,
      speed: typeof res.speed === 'number' && res.speed > 0 ? res.speed : 0
    }
  },

  buildTestLocation(advance = false) {
    if (!this.testLocationState) {
      this.testLocationState = {
        latitude: TEST_START_LATITUDE,
        longitude: TEST_START_LONGITUDE
      }
    } else if (advance) {
      this.testLocationState = {
        latitude: Number((this.testLocationState.latitude + TEST_LOCATION_STEP).toFixed(14)),
        longitude: Number((this.testLocationState.longitude + TEST_LOCATION_STEP).toFixed(14))
      }
    }

    return {
      latitude: this.testLocationState.latitude,
      longitude: this.testLocationState.longitude,
      speed: 0
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

  async startLocationTracking() {
    if (this.locationTrackingStarted) {
      return true
    }

    const hasPermission = await this.ensureLocationPermission()
    if (!hasPermission) {
      wx.showToast({ title: '未开启定位权限', icon: 'none' })
      return false
    }

    const handler = (res) => {
      const location = this.normalizeLocation(res)
      this.latestLocation = location
      this.updateLocationPanel(location)

      if (this.data.autoUpload) {
        this.enqueueUpload(location, false, true)
      }
    }

    try {
      if (this.locationChangeHandler && wx.offLocationChange) {
        wx.offLocationChange(this.locationChangeHandler)
      }

      this.locationChangeHandler = handler
      wx.onLocationChange(handler)

      try {
        await this.startLocationUpdateBackground()
      } catch (backgroundErr) {
        await this.startLocationUpdate()
      }

      this.locationTrackingStarted = true
      return true
    } catch (e) {
      const errMsg = e && e.errMsg ? e.errMsg : ''
      if (this.isLocationServiceError(errMsg)) {
        wx.showToast({ title: '请打开手机定位服务', icon: 'none' })
      } else {
        wx.showToast({ title: '开启持续定位失败', icon: 'none' })
      }

      if (this.locationChangeHandler && wx.offLocationChange) {
        wx.offLocationChange(this.locationChangeHandler)
      }

      this.locationChangeHandler = null
      this.locationTrackingStarted = false
      return false
    }
  },

  stopLocationTracking() {
    this.clearPendingUploadTimer()
    this.pendingUploadLocation = null

    if (this.locationChangeHandler && wx.offLocationChange) {
      try {
        wx.offLocationChange(this.locationChangeHandler)
      } catch (e) {
      }
    }

    this.locationChangeHandler = null
    this.locationTrackingStarted = false
    this.stopLocationUpdate()
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
      this.stopAutoUploadInternal(true, '首次定位失败')
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
        title: autoUploadReady ? '已发车' : '已发车，请检查定位',
        icon: autoUploadReady ? 'success' : 'none'
      })
    } catch (e) {
      wx.showToast({ title: e.message || e.msg || '发车失败', icon: 'none' })
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

      wx.showToast({ title: '已结束发车', icon: 'success' })
      return true
    } catch (e) {
      wx.showToast({ title: e.message || e.msg || '结束发车失败', icon: 'none' })
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
      wx.showToast({ title: '未开启定位权限', icon: 'none' })
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
        wx.showToast({ title: '请打开手机定位服务', icon: 'none' })
        return
      }
      wx.showToast({ title: '定位失败，请重试', icon: 'none' })
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
      this.stopTestLocationSimulation(true, '测试已停止')
      return
    }

    this.stopAutoUploadInternal(false)
    this.stopLocationTracking()
    this.testLocationState = null

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
          this.stopTestLocationSimulation(true, '测试已停止')
        }
      } finally {
        this.testUploadRunning = false
      }
    }, TEST_LOCATION_INTERVAL_MS)

    wx.showToast({ title: '测试已开始', icon: 'success' })
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
        wx.showToast({ title: '上报成功', icon: 'success' })
      }
      return true
    } catch (e) {
      const msg = e && e.message ? e.message : (e && e.msg ? e.msg : '位置上报失败')
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
})
