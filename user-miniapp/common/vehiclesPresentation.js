const {
  resolveVehicleCurrentSpeed,
  buildVehicleMotionSnapshot
} = require('./vehicleState')

module.exports = {
  isVehicleVisibleToUser(item) {
    return !!(item && String(item.status || '').toUpperCase() === 'RUNNING')
  },

  filterVehicles(vehicles) {
    const list = Array.isArray(vehicles) ? vehicles : []

    if (this.data.detailMode) {
      return list.filter(item => item.vehicleId === this.data.vehicleId && this.isVehicleVisibleToUser(item))
    }

    return list.filter(item => this.isVehicleVisibleToUser(item) && (!this.data.routeId || item.routeId === this.data.routeId))
  },

  applyVehicles(vehicles) {
    const visibleVehicles = this.filterVehicles(vehicles)
    const receivedAt = Date.now()
    const nextVehicleIds = {}
    visibleVehicles.forEach((item) => {
      if (item && item.vehicleId) {
        nextVehicleIds[item.vehicleId] = true
      }
    })
    Object.keys(this.vehicleMotionMap).forEach((vehicleId) => {
      if (!nextVehicleIds[vehicleId]) {
        delete this.vehicleMotionMap[vehicleId]
      }
    })
    const decoratedVehicles = visibleVehicles.map(item => this.decorateVehicle(item, receivedAt))
    this.setData({
      vehicles: decoratedVehicles,
      liveVehicleCount: decoratedVehicles.length,
      stoppedVehicleCount: decoratedVehicles.filter(item => item.status === 'STOPPED').length,
      lastUpdateText: this.formatClock(new Date())
    })
  },

  decorateVehicle(item, receivedAt = Date.now()) {
    const { latitude, longitude } = this.normalizeCoordinatePair(item.latitude, item.longitude)
    const previousMotion = this.vehicleMotionMap[item.vehicleId] || null
    const speed = resolveVehicleCurrentSpeed({
      latitude,
      longitude,
      speed: item.speed,
      updateTime: item.updateTime,
      status: item.status
    }, previousMotion, receivedAt)
    this.vehicleMotionMap[item.vehicleId] = buildVehicleMotionSnapshot(
      item,
      latitude,
      longitude,
      speed,
      receivedAt
    )
    const status = item.status || 'UNKNOWN'
    const statusTextMap = {
      RUNNING: '运行中',
      STOPPED: '已收车',
      UNKNOWN: '待更新'
    }
    const statusClassMap = {
      RUNNING: 'vehicle-status-running',
      STOPPED: 'vehicle-status-stopped',
      UNKNOWN: 'vehicle-status-idle'
    }

    return {
      ...item,
      status,
      statusText: statusTextMap[status] || '待更新',
      statusClass: statusClassMap[status] || 'vehicle-status-idle',
      latitudeText: this.formatCoordinateText(latitude),
      longitudeText: this.formatCoordinateText(longitude),
      coordinateStateText: latitude !== null && longitude !== null ? '已定位' : '未定位',
      speedText: `${Number(speed || 0).toFixed(1)} m/s`,
      updateTimeText: this.formatUpdateTime(item.updateTime)
    }
  }
}
