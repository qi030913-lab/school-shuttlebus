const { request } = require('./request')

module.exports = {
  getOverviewErrorMessage(message) {
    return message || '加载失败，请稍后重试'
  },

  async loadRoutes() {
    try {
      const routes = await request('/api/common/routes')
      const first = routes[0] || {}
      this.shouldResetMapCenter = true
      this.setData({
        routes,
        routeIndex: 0,
        currentRouteId: first.routeId || '',
        routeName: first.routeName || '',
        routeServiceTime: first.serviceTime || ''
      })
      if (first.routeId) {
        await this.loadOverview(false, first.routeId)
      }
    } catch (e) {
      wx.showToast({
        title: this.getOverviewErrorMessage('加载线路失败，请稍后重试'),
        icon: 'none'
      })
    }
  },

  onRouteChange(e) {
    const routeIndex = Number(e.detail.value)
    const route = this.data.routes[routeIndex] || {}

    this.shouldResetMapCenter = true
    this.setData({
      routeIndex,
      currentRouteId: route.routeId || '',
      routeName: route.routeName || '',
      routeServiceTime: route.serviceTime || ''
    })

    this.loadOverview(true, route.routeId || '')
  },

  async refreshAll() {
    this.logLocationDebug('refresh-all-start', {
      currentRouteId: this.data.currentRouteId || '',
      refreshing: this.data.refreshing
    })
    const locationRefreshed = await this.refreshUserLocation(false)
    this.logLocationDebug('refresh-all-after-location', {
      locationRefreshed
    })
    await this.loadOverview(true)
    this.logLocationDebug('refresh-all-finished')
  },

  async loadOverview(showLoading = true, routeId = '') {
    const shouldShowLoading = typeof showLoading === 'boolean' ? showLoading : true
    const targetRouteId = routeId || this.data.currentRouteId
    const shouldToastError = shouldShowLoading || !!routeId
    if (!targetRouteId) {
      return
    }

    if (shouldShowLoading) {
      this.setData({ refreshing: true })
    }

    try {
      const overview = await request(`/api/user/overview?routeId=${targetRouteId}`)
      if (targetRouteId !== this.data.currentRouteId) {
        return
      }
      const isBackgroundPoll = !shouldShowLoading && !routeId
      const includeVehicles = !(isBackgroundPoll && this.socketStatus === 'connected')
      this.applyOverview(overview, { includeVehicles })
    } catch (e) {
      if (shouldToastError) {
        wx.showToast({
          title: this.getOverviewErrorMessage('获取车辆信息失败，请稍后重试'),
          icon: 'none'
        })
      }
    } finally {
      if (shouldShowLoading) {
        this.setData({ refreshing: false })
      }
    }
  },

  applyOverview(overview, options = {}) {
    const { includeVehicles = true } = options
    const vehicles = Array.isArray(overview.vehicles) ? overview.vehicles : []
    const route = overview.route || {}
    const nextServiceTime = route.serviceTime || this.data.routeServiceTime

    this.setData({
      routeName: route.routeName || this.data.routeName,
      routeServiceTime: nextServiceTime,
      routeProgressWidth: this.getRouteProgressWidth(nextServiceTime)
    })

    if (includeVehicles) {
      this.applyVehicles(vehicles)
    }
  },

  getRouteProgressWidth(serviceTime) {
    if (!serviceTime || !serviceTime.includes('-')) {
      return '72%'
    }

    const [startText, endText] = serviceTime.split('-')
    const startHour = this.parseTimeToMinutes(startText)
    const endHour = this.parseTimeToMinutes(endText)
    if (startHour === null || endHour === null || endHour <= startHour) {
      return '72%'
    }

    const now = new Date()
    const currentMinutes = now.getHours() * 60 + now.getMinutes()
    const clamped = Math.min(Math.max(currentMinutes, startHour), endHour)
    const ratio = (clamped - startHour) / (endHour - startHour)
    const percent = 18 + ratio * 70
    return `${percent.toFixed(0)}%`
  }
}
