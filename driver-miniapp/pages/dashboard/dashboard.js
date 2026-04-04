const { request } = require('../../utils')

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
    nearestStationName: '--',
    etaMinutes: '--',
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

    try {
      const me = await request('/api/driver/me')
      this.setData({
        driverName: me.driverName || '',
        vehicleId: me.vehicleId || '',
        routeId: me.routeId || ''
      })
    } catch (e) {
      wx.showToast({ title: '登录态失效，请重新登录', icon: 'none' })
      wx.removeStorageSync('driverInfo')
      wx.redirectTo({ url: '/pages/login/login' })
    }
  },

  onUnload() {
    this.clearTimer()
  },

  clearTimer() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
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

  stopAutoUpload(message) {
    this.clearTimer()
    this.setData({ autoUpload: false })
    if (message) {
      wx.showToast({ title: message, icon: 'none' })
    }
  },

  async startTrip() {
    try {
      await request('/api/driver/start', 'POST', {})
      this.setData({ tripStatus: '运行中' })
      wx.showToast({ title: '已发车', icon: 'success' })
    } catch (e) {
      wx.showToast({ title: e.message || e.msg || '发车失败', icon: 'none' })
    }
  },

  async stopTrip() {
    try {
      await request('/api/driver/stop', 'POST', {})
      this.setData({ tripStatus: '已结束', autoUpload: false })
      this.clearTimer()
      wx.showToast({ title: '已结束', icon: 'success' })
    } catch (e) {
      wx.showToast({ title: e.message || e.msg || '结束失败', icon: 'none' })
    }
  },

  uploadOnce() {
    this.doUploadLocation(false)
  },

  async toggleAutoUpload() {
    if (this.data.autoUpload) {
      this.stopAutoUpload()
      return
    }

    const firstUploadSuccess = await this.doUploadLocation(false)
    if (!firstUploadSuccess) {
      return
    }

    this.setData({ autoUpload: true })
    this.clearTimer()
    this.timer = setInterval(() => {
      this.doUploadLocation(true)
    }, 5000)
  },

  async doUploadLocation(silent) {
    const hasPermission = await this.ensureLocationPermission()
    if (!hasPermission) {
      if (this.data.autoUpload || silent) {
        this.stopAutoUpload('未开启定位权限')
      }
      return false
    }

    try {
      const res = await this.getLocation()
      const payload = {
        latitude: res.latitude,
        longitude: res.longitude,
        speed: res.speed || 0
      }
      const result = await request('/api/driver/location', 'POST', payload)

      this.setData({
        latitude: Number(res.latitude).toFixed(6),
        longitude: Number(res.longitude).toFixed(6),
        speed: Number(res.speed || 0).toFixed(2),
        nearestStationName: result.nearestStationName || '--',
        etaMinutes: result.etaMinutes !== null && result.etaMinutes !== undefined ? result.etaMinutes : '--',
        tripStatus: result.status === 'RUNNING' ? '运行中' : '已结束'
      })

      if (!silent) {
        wx.showToast({ title: '上报成功', icon: 'success' })
      }
      return true
    } catch (e) {
      const errMsg = e && e.errMsg ? e.errMsg : ''

      if (this.isPermissionError(errMsg)) {
        const opened = await this.openLocationSetting()
        if (opened) {
          return this.doUploadLocation(silent)
        }
        if (this.data.autoUpload || silent) {
          this.stopAutoUpload('未开启定位权限')
        } else {
          wx.showToast({ title: '未开启定位权限', icon: 'none' })
        }
        return false
      }

      if (this.isLocationServiceError(errMsg)) {
        if (this.data.autoUpload || silent) {
          this.stopAutoUpload('请打开手机定位服务')
        } else {
          wx.showToast({ title: '请打开手机定位服务', icon: 'none' })
        }
        return false
      }

      const msg = e && e.message ? e.message : (e && e.msg ? e.msg : '定位失败，请重试')
      if (this.data.autoUpload || silent) {
        this.stopAutoUpload(msg)
      } else {
        wx.showToast({ title: msg, icon: 'none' })
      }
      return false
    }
  },

  logout() {
    this.clearTimer()
    wx.removeStorageSync('driverInfo')
    wx.redirectTo({ url: '/pages/login/login' })
  }
})
