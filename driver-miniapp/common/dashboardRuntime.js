function createDashboardRuntimeModule(config) {
  const {
    request,
    tripStatusIdleCode,
    tripStatusRunningCode,
    tripStatusStoppedCode,
    tripStatusIdle,
    tripStatusRunning,
    tripStatusStopped,
    messageLoginExpired
  } = config

  return {
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
        wx.showToast({ title: messageLoginExpired, icon: 'none' })
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

    normalizeTripStatus(status) {
      const normalized = String(status || '').toUpperCase()
      if (normalized === tripStatusRunningCode) {
        return tripStatusRunningCode
      }
      if (normalized === tripStatusStoppedCode) {
        return tripStatusStoppedCode
      }
      return tripStatusIdleCode
    },

    setTripStatus(status) {
      const nextStatus = this.normalizeTripStatus(status)
      const statusTextMap = {
        [tripStatusIdleCode]: tripStatusIdle,
        [tripStatusRunningCode]: tripStatusRunning,
        [tripStatusStoppedCode]: tripStatusStopped
      }

      this.setData({
        tripStatusCode: nextStatus,
        tripStatus: statusTextMap[nextStatus] || tripStatusIdle
      })

      return nextStatus
    },

    isTripRunning() {
      return this.data.tripStatusCode === tripStatusRunningCode
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
        this.setTripStatus(tripStatusIdleCode)
        this.resetLocationPanel()
        return
      }

      try {
        const runtime = await request(`/api/user/vehicles/${encodeURIComponent(this.data.vehicleId)}`)
        if (!runtime || !runtime.vehicleId) {
          this.setTripStatus(tripStatusIdleCode)
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

        this.setTripStatus(runtime.status)
        this.setData({
          routeId: runtime.routeId || this.data.routeId,
          routeName: runtime.routeName || this.data.routeName
        })
      } catch (e) {
        this.latestLocation = null
        this.setTripStatus(tripStatusIdleCode)
        this.resetLocationPanel()
      }
    }
  }
}

module.exports = {
  createDashboardRuntimeModule
}
