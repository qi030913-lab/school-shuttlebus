function createDashboardActionsModule(config) {
  const {
    request,
    uploadThrottleMs,
    testLocationIntervalMs,
    tripStatusRunningCode,
    tripStatusRunning,
    tripStatusStopped,
    messageFirstLocationFailed,
    messageTripStarted,
    messageTripStartedCheckLocation,
    messageTripStartFailed,
    messageTripStopped,
    messageTripStopFailed,
    messageStartTripFirst,
    messageLocationPermissionMissing,
    messageEnableGps,
    messageLocationFailed,
    messageTestStopped,
    messageTestRoutePreparing,
    messagePlanningRoute,
    messageBuildRouteFailed,
    messageReachedTarget,
    messageTestStartDefault,
    messageTestStartDriving,
    messageTestStartWalking,
    messageTestStartManual,
    messageTestStartFallback,
    messageUploadSuccess,
    messageUploadFailed
  } = config

  return {
    ensureTripRunning() {
      if (this.isTripRunning()) {
        return true
      }

      wx.showToast({ title: messageStartTripFirst, icon: 'none' })
      return false
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
      if (!this.ensureTripRunning()) {
        return false
      }

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
        this.stopAutoUploadInternal(true, messageFirstLocationFailed)
        this.stopLocationTracking()
        return false
      }
    },

    async startTrip() {
      if (this.isTripRunning()) {
        wx.showToast({ title: messageTripStarted, icon: 'none' })
        return
      }

      try {
        this.stopTestLocationSimulation()
        const result = await request('/api/driver/start', 'POST', {})
        this.setTripStatus((result && result.status) || tripStatusRunningCode)
        const autoUploadReady = await this.enableAutoUpload({ showUploadToast: false })
        wx.showToast({
          title: autoUploadReady ? messageTripStarted : messageTripStartedCheckLocation,
          icon: autoUploadReady ? 'success' : 'none'
        })
      } catch (e) {
        wx.showToast({ title: e.message || e.msg || messageTripStartFailed, icon: 'none' })
      }
    },

    async finishTrip({ logoutAfterStop = false } = {}) {
      try {
        this.stopTestLocationSimulation()
        const result = await request('/api/driver/stop', 'POST', {})
        this.stopAutoUploadInternal(false)
        this.stopLocationTracking()

        const hasLocation = result
          && result.latitude !== null
          && result.latitude !== undefined
          && result.longitude !== null
          && result.longitude !== undefined

        if (hasLocation) {
          const location = this.normalizeLocation({
            latitude: result.latitude,
            longitude: result.longitude,
            speed: result.speed || 0
          })
          this.latestLocation = location
          this.updateLocationPanel(location)
        } else {
          this.latestLocation = null
          this.resetLocationPanel()
        }

        this.setTripStatus((result && result.status) || 'STOPPED')

        if (logoutAfterStop) {
          wx.removeStorageSync('driverInfo')
          wx.redirectTo({ url: '/pages/login/login' })
          return true
        }

        wx.showToast({ title: messageTripStopped, icon: 'success' })
        return true
      } catch (e) {
        wx.showToast({ title: e.message || e.msg || messageTripStopFailed, icon: 'none' })
        return false
      }
    },

    async stopTrip() {
      if (!this.ensureTripRunning()) {
        return
      }

      await this.finishTrip()
    },

    async uploadOnce() {
      if (!this.ensureTripRunning()) {
        return
      }

      this.stopTestLocationSimulation()

      const hasPermission = await this.ensureLocationPermission()
      if (!hasPermission) {
        wx.showToast({ title: messageLocationPermissionMissing, icon: 'none' })
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
          wx.showToast({ title: messageEnableGps, icon: 'none' })
          return
        }
        wx.showToast({ title: messageLocationFailed, icon: 'none' })
      }
    },

    async toggleAutoUpload() {
      if (this.data.autoUpload) {
        this.stopAutoUploadInternal(false)
        this.stopLocationTracking()
        return
      }

      if (!this.ensureTripRunning()) {
        return
      }

      await this.enableAutoUpload({ showUploadToast: true })
    },

    async toggleTestLocation() {
      if (this.data.testing) {
        this.stopTestLocationSimulation(true, messageTestStopped)
        return
      }

      if (!this.ensureTripRunning()) {
        return
      }

      if (this.testRouteLoading) {
        wx.showToast({ title: messageTestRoutePreparing, icon: 'none' })
        return
      }

      this.stopAutoUploadInternal(false)
      this.stopLocationTracking()
      this.testLocationState = null
      this.testRouteLoading = true

      let routePlan = null
      wx.showLoading({
        title: messagePlanningRoute,
        mask: true
      })

      try {
        routePlan = await this.ensurePlannedTestRouteLocations()
      } finally {
        this.testRouteLoading = false
        wx.hideLoading()
      }

      if (!routePlan || !Array.isArray(routePlan.routeLocations) || !routePlan.routeLocations.length) {
        wx.showToast({ title: messageBuildRouteFailed, icon: 'none' })
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
            this.stopTestLocationSimulation(true, messageTestStopped)
            return
          }

          if (this.hasReachedTestTarget()) {
            this.stopTestLocationSimulation(true, messageReachedTarget)
          }
        } finally {
          this.testUploadRunning = false
        }
      }, testLocationIntervalMs)

      const startMessageMap = {
        driving: messageTestStartDriving,
        walking: messageTestStartWalking,
        manual: messageTestStartManual,
        fallback: messageTestStartFallback
      }

      wx.showToast({
        title: startMessageMap[routePlan.mode] || messageTestStartDefault,
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
      if (!force && elapsed < uploadThrottleMs) {
        this.pendingUploadLocation = location
        const waitMs = uploadThrottleMs - elapsed

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
      if (!this.isTripRunning()) {
        if (!silent) {
          wx.showToast({ title: messageStartTripFirst, icon: 'none' })
        }
        return false
      }

      this.uploading = true
      this.lastUploadAt = Date.now()

      try {
        const result = await request('/api/driver/location', 'POST', {
          latitude: location.latitude,
          longitude: location.longitude,
          speed: location.speed || 0
        })

        this.updateLocationPanel(location)
        this.setTripStatus(result && result.status)

        if (!silent) {
          wx.showToast({ title: messageUploadSuccess, icon: 'success' })
        }
        return true
      } catch (e) {
        const msg = e && e.message ? e.message : (e && e.msg ? e.msg : messageUploadFailed)
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
          const waitMs = Math.max(0, uploadThrottleMs - (Date.now() - this.lastUploadAt))
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
      this.stopTestLocationSimulation()
      this.stopAutoUploadInternal(false)
      this.stopLocationTracking()

      if (this.isTripRunning()) {
        await this.finishTrip({ logoutAfterStop: true })
        return
      }

      wx.removeStorageSync('driverInfo')
      wx.redirectTo({ url: '/pages/login/login' })
    }
  }
}

module.exports = {
  createDashboardActionsModule
}
