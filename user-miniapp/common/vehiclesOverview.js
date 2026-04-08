const { request } = require('./request')

module.exports = {
  async loadOverview(showLoading = true) {
    const shouldShowLoading = typeof showLoading === 'boolean' ? showLoading : true
    if (!this.data.routeId && !this.data.vehicleId) {
      return
    }

    if (shouldShowLoading) {
      this.setData({ refreshing: true })
    }

    try {
      if (this.data.detailMode) {
        const vehicle = await request(`/api/user/vehicles/${encodeURIComponent(this.data.vehicleId)}`)
        const nextVehicles = vehicle && vehicle.vehicleId ? [vehicle] : []
        this.setData({
          routeId: (vehicle && vehicle.routeId) || this.data.routeId,
          routeName: (vehicle && vehicle.routeName) || this.data.routeName
        })
        this.applyVehicles(nextVehicles)
        return
      }

      const overview = await request(`/api/user/overview?routeId=${this.data.routeId}`)
      const route = overview.route || {}
      this.setData({
        routeName: route.routeName || this.data.routeName,
        serviceTime: route.serviceTime || this.data.serviceTime
      })
      this.applyVehicles(Array.isArray(overview.vehicles) ? overview.vehicles : [])
    } catch (e) {
      wx.showToast({ title: '刷新失败', icon: 'none' })
    } finally {
      if (shouldShowLoading) {
        this.setData({ refreshing: false })
      }
    }
  }
}
