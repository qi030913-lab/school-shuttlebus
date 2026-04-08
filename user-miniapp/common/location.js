module.exports = {
  startLocationPolling() {
    if (this.locationPollTimer) {
      return
    }
    this.locationPollTimer = setInterval(() => {
      this.refreshUserLocation(true)
    }, this.locationPollIntervalMs || 15000)
  },

  getPrivacySetting() {
    if (typeof wx.getPrivacySetting !== 'function') {
      return Promise.resolve({ supported: false })
    }

    return new Promise((resolve, reject) => {
      wx.getPrivacySetting({
        success: resolve,
        fail: reject
      })
    })
  },

  async logPrivacySetting(scene) {
    if (typeof wx.getPrivacySetting !== 'function') {
      this.logLocationDebug(`${scene}-privacy-setting-api-unavailable`)
      return null
    }

    try {
      const privacyRes = await this.getPrivacySetting()
      this.logLocationDebug(`${scene}-privacy-setting`, privacyRes)
      return privacyRes
    } catch (error) {
      this.logLocationDebug(`${scene}-privacy-setting-failed`, this.toDebugError(error))
      return null
    }
  },

  getSetting() {
    return new Promise((resolve, reject) => {
      wx.getSetting({
        success: res => {
          this.logLocationDebug('wx.getSetting.success', {
            authSetting: res.authSetting || {}
          })
          resolve(res)
        },
        fail: err => {
          this.logLocationDebug('wx.getSetting.fail', this.toDebugError(err))
          reject(err)
        }
      })
    })
  },

  authorizeLocation() {
    return new Promise((resolve, reject) => {
      wx.authorize({
        scope: 'scope.userLocation',
        success: res => {
          this.logLocationDebug('wx.authorize.success', {
            scope: 'scope.userLocation',
            res
          })
          resolve(res)
        },
        fail: err => {
          this.logLocationDebug('wx.authorize.fail', this.toDebugError(err))
          reject(err)
        }
      })
    })
  },

  getLocation() {
    return new Promise((resolve, reject) => {
      wx.getLocation({
        type: 'gcj02',
        success: res => {
          this.logLocationDebug('wx.getLocation.success', {
            latitude: res.latitude,
            longitude: res.longitude,
            accuracy: res.accuracy,
            horizontalAccuracy: res.horizontalAccuracy,
            verticalAccuracy: res.verticalAccuracy,
            speed: res.speed
          })
          resolve(res)
        },
        fail: err => {
          this.logLocationDebug('wx.getLocation.fail', this.toDebugError(err))
          reject(err)
        }
      })
    })
  },

  async ensureLocationPermission(silent = true) {
    this.logLocationDebug('ensure-permission-start', { silent })
    try {
      const settingRes = await this.getSetting()
      const locationAuthorized = settingRes.authSetting && settingRes.authSetting['scope.userLocation']
      this.logLocationDebug('ensure-permission-state', {
        locationAuthorized,
        authSetting: settingRes.authSetting || {}
      })

      if (locationAuthorized === true) {
        this.logLocationDebug('ensure-permission-already-authorized')
        return true
      }

      if (locationAuthorized !== false) {
        try {
          this.logLocationDebug('ensure-permission-request-authorize')
          await this.authorizeLocation()
          this.logLocationDebug('ensure-permission-authorize-finished')
          return true
        } catch (error) {
          this.logLocationDebug('ensure-permission-authorize-rejected', this.toDebugError(error))
          if (!silent) {
            wx.showToast({ title: '请允许定位后再查看距离', icon: 'none' })
          }
          return false
        }
      }

      if (!silent) {
        wx.showToast({ title: '定位权限已关闭，请在设置中开启', icon: 'none' })
      }
      this.logLocationDebug('ensure-permission-denied-in-setting')
      return false
    } catch (error) {
      this.logLocationDebug('ensure-permission-check-failed', this.toDebugError(error))
      if (!silent) {
        wx.showToast({ title: '定位权限检查失败', icon: 'none' })
      }
      return false
    }
  },

  async refreshUserLocation(silent = true) {
    this.logLocationDebug('refresh-user-location-start', {
      silent,
      currentRouteId: this.data.currentRouteId || ''
    })
    const hasPermission = await this.ensureLocationPermission(silent)
    this.logLocationDebug('refresh-user-location-permission-result', { hasPermission })
    if (!hasPermission) {
      this.applyDefaultUserLocation('permission-not-granted')
      this.logLocationDebug('refresh-user-location-stop-no-permission')
      return false
    }

    await this.logPrivacySetting('before-get-location')

    try {
      const location = await this.getLocation()
      const userLocation = this.normalizeCoordinatePair(location.latitude, location.longitude, 'user-location')
      this.logLocationDebug('refresh-user-location-normalized', {
        rawLatitude: location.latitude,
        rawLongitude: location.longitude,
        normalizedLatitude: userLocation.latitude,
        normalizedLongitude: userLocation.longitude
      })
      if (userLocation.latitude === null || userLocation.longitude === null) {
        this.logLocationDebug('refresh-user-location-invalid-normalized-coordinate', {
          rawLatitude: location.latitude,
          rawLongitude: location.longitude
        })
        throw new Error('invalid-user-location')
      }
      this.userLocation = userLocation
      this.setData({
        userLocationText: '已显示你的位置，并连线到在线车辆'
      })
      this.refreshVehiclePresentation()
      this.logLocationDebug('refresh-user-location-success', { userLocation })
      return true
    } catch (error) {
      await this.logPrivacySetting('after-get-location-failed')
      const feedback = this.getInvalidLocationFeedback(error)
      if (error && error.message === 'invalid-user-location' && this.isDevtoolsPlatform()) {
        this.logLocationDebug('devtools-invalid-location-detected', {
          runtimeInfo: this.runtimeInfo
        })
      }
      this.logLocationDebug('refresh-user-location-failed', {
        error: this.toDebugError(error),
        currentRouteId: this.data.currentRouteId || '',
        runtimeInfo: this.runtimeInfo
      })
      this.applyDefaultUserLocation(error && error.message ? error.message : 'get-location-failed')
      if (!silent) {
        wx.showToast({ title: feedback.toastTitle, icon: 'none' })
      }
      return false
    }
  }
}
