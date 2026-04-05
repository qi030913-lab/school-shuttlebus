const { request, WS_URL } = require('../../utils')

const POLL_INTERVAL_MS = 15000
const SOCKET_RETRY_BASE_MS = 2000
const SOCKET_RETRY_MAX_MS = 15000

Page({
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

  clearSocketReconnectTimer() {
    if (this.socketReconnectTimer) {
      clearTimeout(this.socketReconnectTimer)
      this.socketReconnectTimer = null
    }
  },

  scheduleSocketReconnect() {
    if (this.socketClosedByUser || this.socketReconnectTimer) {
      return
    }

    this.socketRetryCount += 1
    this.setSocketStatus('reconnecting')

    const delay = Math.min(SOCKET_RETRY_MAX_MS, SOCKET_RETRY_BASE_MS * this.socketRetryCount)
    this.socketReconnectTimer = setTimeout(() => {
      this.socketReconnectTimer = null
      if (!this.socketClosedByUser) {
        this.connectSocket()
      }
    }, delay)
  },

  connectSocket() {
    this.clearSocketReconnectTimer()
    this.setSocketStatus(this.socketRetryCount > 0 ? 'reconnecting' : 'connecting')

    const socketTask = wx.connectSocket({ url: WS_URL })
    this.socketTask = socketTask

    socketTask.onOpen(() => {
      if (this.socketTask !== socketTask) {
        return
      }
      this.socketRetryCount = 0
      this.setSocketStatus('connected')
    })

    socketTask.onMessage((res) => {
      if (this.socketTask !== socketTask) {
        return
      }

      try {
        const body = JSON.parse(res.data)
        const vehicles = Array.isArray(body && body.data) ? body.data : []
        const filtered = this.filterVehicles(vehicles)
        this.applyVehicles(filtered, true)
      } catch (e) {
        console.log('vehicle socket parse skip', e)
      }
    })

    socketTask.onError(() => {
      if (this.socketTask !== socketTask) {
        return
      }
      this.setSocketStatus('reconnecting')
    })

    socketTask.onClose(() => {
      if (this.socketTask !== socketTask) {
        return
      }
      this.socketTask = null
      if (this.socketClosedByUser) {
        this.setSocketStatus('disconnected')
        return
      }
      this.scheduleSocketReconnect()
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
    const decoratedVehicles = vehicles.map(item => this.decorateVehicle(item))
    this.setData({
      vehicles: decoratedVehicles,
      liveVehicleCount: decoratedVehicles.length,
      stoppedVehicleCount: decoratedVehicles.filter(item => item.status === 'STOPPED').length,
      lastUpdateText: this.formatClock(new Date())
    })
  },

  decorateVehicle(item) {
    const { latitude, longitude } = this.normalizeCoordinatePair(item.latitude, item.longitude)
    const speed = typeof item.speed === 'number' ? item.speed : 0
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
  },

  parseCoordinate(value) {
    if (value === null || value === undefined || value === '') {
      return null
    }
    const num = Number(value)
    return Number.isFinite(num) ? num : null
  },

  isValidLatitude(value) {
    return typeof value === 'number' && value >= -90 && value <= 90
  },

  isValidLongitude(value) {
    return typeof value === 'number' && value >= -180 && value <= 180
  },

  normalizeCoordinatePair(latitudeValue, longitudeValue) {
    const latitude = this.parseCoordinate(latitudeValue)
    const longitude = this.parseCoordinate(longitudeValue)

    if (latitude === null || longitude === null) {
      return {
        latitude: null,
        longitude: null
      }
    }

    if (this.isValidLatitude(latitude) && this.isValidLongitude(longitude)) {
      return { latitude, longitude }
    }

    if (this.isValidLatitude(longitude) && this.isValidLongitude(latitude)) {
      return {
        latitude: longitude,
        longitude: latitude
      }
    }

    return {
      latitude: null,
      longitude: null
    }
  },

  formatCoordinateText(value) {
    return value !== null ? value.toFixed(6) : '--'
  },

  formatClock(date) {
    const hh = String(date.getHours()).padStart(2, '0')
    const mm = String(date.getMinutes()).padStart(2, '0')
    const ss = String(date.getSeconds()).padStart(2, '0')
    return `${hh}:${mm}:${ss}`
  },

  formatUpdateTime(value) {
    if (!value) {
      return '--'
    }

    if (Array.isArray(value) && value.length >= 6) {
      const [year, month, day, hour, minute, second] = value
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`
    }

    if (typeof value === 'string') {
      return value.replace('T', ' ').slice(0, 19)
    }

    if (typeof value === 'number') {
      return this.formatDateTime(new Date(value))
    }

    if (typeof value === 'object') {
      const year = value.year
      const month = value.monthValue || value.month
      const day = value.dayOfMonth || value.day
      const hour = value.hour
      const minute = value.minute
      const second = value.second

      if (
        year !== undefined
        && month !== undefined
        && day !== undefined
        && hour !== undefined
        && minute !== undefined
        && second !== undefined
      ) {
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`
      }
    }

    return '--'
  },

  formatDateTime(date) {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const hh = String(date.getHours()).padStart(2, '0')
    const mm = String(date.getMinutes()).padStart(2, '0')
    const ss = String(date.getSeconds()).padStart(2, '0')
    return `${year}-${month}-${day} ${hh}:${mm}:${ss}`
  }
})
