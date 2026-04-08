const { request } = require('../../common/request')
const {
  resolveVehicleCurrentSpeed,
  buildVehicleMotionSnapshot
} = require('../../common/vehicleState')
const socketModule = require('../../common/socket')
const pageHelpers = require('../../common/pageHelpers')

const POLL_INTERVAL_MS = 15000
const SOCKET_RETRY_BASE_MS = 2000
const SOCKET_RETRY_MAX_MS = 15000

const pageDefinition = {
  data: {
    routeId: '',
    routeName: '',
    serviceTime: '',
    vehicleId: '',
    detailMode: false,
    vehicles: [],
    refreshing: false,
    socketStatusText: '实时连接中',
    socketStatusClass: 'status-connecting',
    liveVehicleCount: 0,
    stoppedVehicleCount: 0,
    lastUpdateText: '--:--:--',
    pageTitle: '车辆明细',
    pageSubtitle: '实时展示司机、状态、速度、经纬度与更新时间',
    emptyText: '当前线路暂时没有在线摆渡车'
  },

  async onLoad(options) {
    this.socketTask = null
    this.socketReconnectTimer = null
    this.socketClosedByUser = false
    this.socketRetryCount = 0
    this.socketRetryBaseMs = SOCKET_RETRY_BASE_MS
    this.socketRetryMaxMs = SOCKET_RETRY_MAX_MS
    this.vehicleMotionMap = {}

    const routeId = decodeURIComponent(options.routeId || '')
    const routeName = decodeURIComponent(options.routeName || '')
    const serviceTime = decodeURIComponent(options.serviceTime || '')
    const vehicleId = decodeURIComponent(options.vehicleId || '')
    const detailMode = !!vehicleId

    this.setData({
      routeId,
      routeName,
      serviceTime,
      vehicleId,
      detailMode,
      pageTitle: detailMode ? '车辆详情' : '车辆明细',
      pageSubtitle: detailMode
        ? '查看当前车辆的实时状态、速度、经纬度与更新时间'
        : '实时展示司机、状态、速度、经纬度与更新时间',
      emptyText: detailMode ? '当前未获取到该车辆信息' : '当前线路暂时没有在线摆渡车'
    })

    if (detailMode) {
      wx.setNavigationBarTitle({
        title: '车辆详情'
      })
    }

    if (!routeId && !vehicleId) {
      wx.showToast({ title: '缺少车辆信息', icon: 'none' })
      return
    }

    await this.loadOverview(false)
    this.connectSocket()
    this.pollTimer = setInterval(() => {
      this.loadOverview(false)
    }, POLL_INTERVAL_MS)
  },

  onUnload() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    this.clearSocketReconnectTimer()
    this.socketClosedByUser = true
    if (this.socketTask) {
      this.socketTask.close()
      this.socketTask = null
    }
    this.vehicleMotionMap = {}
  },

  filterSocketVehicles(vehicles) {
    return this.filterVehicles(vehicles)
  },

  handleSocketVehicles(vehicles) {
    this.applyVehicles(vehicles, true)
  },

  handleSocketParseError(error) {
    console.log('vehicle socket parse skip', error)
  },

  setSocketStatus(status) {
    const statusMap = {
      connecting: {
        text: '实时连接中',
        className: 'status-connecting'
      },
      connected: {
        text: '实时已连接',
        className: 'status-connected'
      },
      reconnecting: {
        text: '正在重连',
        className: 'status-reconnecting'
      },
      disconnected: {
        text: '实时已断开',
        className: 'status-disconnected'
      }
    }

    const current = statusMap[status] || statusMap.disconnected
    this.setData({
      socketStatusText: current.text,
      socketStatusClass: current.className
    })
  },

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
        this.applyVehicles(nextVehicles, false)
        return
      }

      const overview = await request(`/api/user/overview?routeId=${this.data.routeId}`)
      const route = overview.route || {}
      this.setData({
        routeName: route.routeName || this.data.routeName,
        serviceTime: route.serviceTime || this.data.serviceTime
      })
      this.applyVehicles(Array.isArray(overview.vehicles) ? overview.vehicles : [], false)
    } catch (e) {
      wx.showToast({ title: '刷新失败', icon: 'none' })
    } finally {
      if (shouldShowLoading) {
        this.setData({ refreshing: false })
      }
    }
  },

  filterVehicles(vehicles) {
    const list = Array.isArray(vehicles) ? vehicles : []

    if (this.data.detailMode) {
      return list.filter(item => item.vehicleId === this.data.vehicleId)
    }

    return list.filter(item => !this.data.routeId || item.routeId === this.data.routeId)
  },

  applyVehicles(vehicles, fromSocket) {
    const receivedAt = Date.now()
    const nextVehicleIds = {}
    vehicles.forEach((item) => {
      if (item && item.vehicleId) {
        nextVehicleIds[item.vehicleId] = true
      }
    })
    Object.keys(this.vehicleMotionMap).forEach((vehicleId) => {
      if (!nextVehicleIds[vehicleId]) {
        delete this.vehicleMotionMap[vehicleId]
      }
    })
    const decoratedVehicles = vehicles.map(item => this.decorateVehicle(item, receivedAt))
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

module.exports = Object.assign({}, pageDefinition, socketModule, pageHelpers)
