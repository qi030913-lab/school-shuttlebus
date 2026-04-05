const { request } = require('../../utils')

const UPLOAD_THROTTLE_MS = 5000

Page({
  data: {
    driverName: '',
    vehicleId: '',
    routeId: '',
    routeName: '',
    tripStatus: '未发车',
    latitude: '--',
    longitude: '--',
    speed: '--',
    autoUpload: false,
    mockMode: false
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

  onHide() {
  },

  onUnload() {
    this.stopAutoUploadInternal(false)
    this.stopLocationTracking()
  },

  clearPendingUploadTimer() {
    if (this.pendingUploadTimer) {
      clearTimeout(this.pendingUploadTimer)
      this.pendingUploadTimer = null
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

  isPermissionError(errMsg = '') {
    const text = String(errMsg).toLowerCase()
    return text.includes('auth deny')
      || text.includes('auth denied')
      || text.includes('permission denied')
      || text.includes('scope.userlocation')
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
      this.setData({ tripStatus: '未发车' })
      this.resetLocationPanel()
      return
    }

    try {
      const runtime = await request(`/api/user/vehicles/${encodeURIComponent(this.data.vehicleId)}`)
      if (!runtime || !runtime.vehicleId) {
        this.setData({ tripStatus: '未发车' })
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
        tripStatus: runtime.status === 'RUNNING' ? '运行中' : '已结束',
        routeId: runtime.routeId || this.data.routeId,
        routeName: runtime.routeName || this.data.routeName
      })
    } catch (e) {
      this.latestLocation = null
      this.setData({ tripStatus: '未发车' })
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

  async startTrip() {
    try {
      await request('/api/driver/start', 'POST', {})
      await this.tryUploadStartupLocation()
      this.setData({ tripStatus: '运行中' })
      wx.showToast({ title: '已发车', icon: 'success' })
    } catch (e) {
      wx.showToast({ title: e.message || e.msg || '发车失败', icon: 'none' })
    }
  },

  async tryUploadStartupLocation() {
    try {
      if (this.latestLocation) {
        await this.uploadLocation(this.latestLocation, true)
        return
      }

      const hasPermission = await this.ensureLocationPermission()
      if (!hasPermission) {
        return
      }

      const location = this.normalizeLocation(await this.getLocation())
      this.latestLocation = location
      this.updateLocationPanel(location)
      await this.uploadLocation(location, true)
    } catch (e) {
    }
  },

  async stopTrip() {
    try {
      await request('/api/driver/stop', 'POST', {})
      this.stopAutoUploadInternal(false)
      this.stopLocationTracking()
      this.setData({ tripStatus: '已结束' })
      wx.showToast({ title: '已结束', icon: 'success' })
    } catch (e) {
      wx.showToast({ title: e.message || e.msg || '结束失败', icon: 'none' })
    }
  },

  async uploadOnce() {
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

    const trackingReady = await this.startLocationTracking()
    if (!trackingReady) {
      return
    }

    this.setData({ autoUpload: true })

    if (this.latestLocation) {
      const success = await this.enqueueUpload(this.latestLocation, true, false)
      if (!success) {
        this.stopLocationTracking()
      }
      return
    }

    try {
      const location = this.normalizeLocation(await this.getLocation())
      this.latestLocation = location
      this.updateLocationPanel(location)
      const success = await this.enqueueUpload(location, true, false)
      if (!success) {
        this.stopLocationTracking()
      }
    } catch (e) {
      this.stopAutoUploadInternal(true, '首次定位失败')
      this.stopLocationTracking()
    }
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
        tripStatus: result.status === 'RUNNING' ? '运行中' : '已结束'
      })

      if (!silent) {
        wx.showToast({ title: '上报成功', icon: 'success' })
      }
      return true
    } catch (e) {
      const msg = e && e.message ? e.message : (e && e.msg ? e.msg : '位置上报失败')
      if (this.data.autoUpload) {
        this.stopAutoUploadInternal(true, msg)
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

  logout() {
    this.stopAutoUploadInternal(false)
    this.stopLocationTracking()
    wx.removeStorageSync('driverInfo')
    wx.redirectTo({ url: '/pages/login/login' })
  }
})
