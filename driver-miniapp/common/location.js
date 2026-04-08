function createDashboardLocationModule(messages) {
  return {
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
          title: messages.needLocationPermission,
          content: messages.needLocationPermissionDesc,
          confirmText: messages.goEnable,
          cancelText: messages.cancel,
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
      } catch (error) {
        wx.showToast({ title: messages.openSettingFailed, icon: 'none' })
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
          } catch (error) {
            return this.openLocationSetting()
          }
        }

        return this.openLocationSetting()
      } catch (error) {
        wx.showToast({ title: messages.checkPermissionFailed, icon: 'none' })
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

    async startLocationTracking() {
      if (this.locationTrackingStarted) {
        return true
      }

      const hasPermission = await this.ensureLocationPermission()
      if (!hasPermission) {
        wx.showToast({ title: messages.locationPermissionMissing, icon: 'none' })
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
      } catch (error) {
        const errMsg = error && error.errMsg ? error.errMsg : ''
        if (this.isLocationServiceError(errMsg)) {
          wx.showToast({ title: messages.enableGps, icon: 'none' })
        } else {
          wx.showToast({ title: messages.startTrackingFailed, icon: 'none' })
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
        } catch (error) {
        }
      }

      this.locationChangeHandler = null
      this.locationTrackingStarted = false
      this.stopLocationUpdate()
    }
  }
}

module.exports = {
  createDashboardLocationModule
}
