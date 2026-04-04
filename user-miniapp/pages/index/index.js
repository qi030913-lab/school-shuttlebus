const { request, WS_URL } = require('../../utils')

const POLL_INTERVAL_MS = 15000
const SOCKET_RETRY_BASE_MS = 2000
const SOCKET_RETRY_MAX_MS = 15000

Page({
  data: {
    routes: [],
    routeIndex: 0,
    currentRouteId: '',
    routeName: '',
    routeServiceTime: '',
    vehicles: [],
    mapLatitude: 39.909,
    mapLongitude: 116.397,
    markers: [],
    polyline: [],
    refreshing: false,
    socketStatusText: '实时连接中',
    socketStatusClass: 'status-connecting',
    lastUpdateMode: '等待数据',
    lastUpdateText: '--:--:--',
    liveVehicleCount: 0
  },

  async onLoad() {
    this.socketTask = null
    this.socketReconnectTimer = null
    this.socketClosedByUser = false
    this.socketRetryCount = 0
    this.shouldResetMapCenter = true

    await this.loadRoutes()
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
        const filtered = vehicles.filter(item => !this.data.currentRouteId || item.routeId === this.data.currentRouteId)
        this.applyVehicles(filtered, true)
      } catch (e) {
        console.log('socket parse skip', e)
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
        await this.loadOverview(false)
      }
    } catch (e) {
      wx.showToast({ title: '加载线路失败', icon: 'none' })
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

    this.loadOverview(true)
  },

  goToVehiclesPage() {
    const {
      currentRouteId,
      routeName,
      routeServiceTime
    } = this.data

    const query = [
      `routeId=${encodeURIComponent(currentRouteId || '')}`,
      `routeName=${encodeURIComponent(routeName || '')}`,
      `serviceTime=${encodeURIComponent(routeServiceTime || '')}`
    ].join('&')

    wx.navigateTo({
      url: `/pages/vehicles/index?${query}`
    })
  },

  async loadOverview(showLoading = true) {
    const shouldShowLoading = typeof showLoading === 'boolean' ? showLoading : true
    if (!this.data.currentRouteId) {
      return
    }

    if (shouldShowLoading) {
      this.setData({ refreshing: true })
    }

    try {
      const overview = await request(`/api/user/overview?routeId=${this.data.currentRouteId}`)
      this.applyOverview(overview)
    } catch (e) {
      wx.showToast({ title: '刷新失败', icon: 'none' })
    } finally {
      if (shouldShowLoading) {
        this.setData({ refreshing: false })
      }
    }
  },

  applyOverview(overview) {
    const vehicles = Array.isArray(overview.vehicles) ? overview.vehicles : []
    const route = overview.route || {}

    this.setData({
      routeName: route.routeName || this.data.routeName,
      routeServiceTime: route.serviceTime || this.data.routeServiceTime
    })

    this.applyVehicles(vehicles, false)
  },

  applyVehicles(vehicles, fromSocket) {
    const decoratedVehicles = vehicles.map(item => this.decorateVehicle(item))
    const vehicleMarkers = this.buildVehicleMarkers(decoratedVehicles)

    const nextState = {
      vehicles: decoratedVehicles,
      markers: vehicleMarkers,
      polyline: [],
      liveVehicleCount: decoratedVehicles.length
    }

    if (this.shouldResetMapCenter) {
      const firstMarker = vehicleMarkers[0]
      nextState.mapLatitude = firstMarker ? firstMarker.latitude : 39.909
      nextState.mapLongitude = firstMarker ? firstMarker.longitude : 116.397
      this.shouldResetMapCenter = false
    }

    this.setData(nextState)
    this.updateLastUpdate(fromSocket ? '实时推送' : '接口刷新')
  },

  buildVehicleMarkers(vehicles) {
    const clusters = []
    let markerId = 1

    vehicles
      .filter(item => item.latitude !== null && item.longitude !== null)
      .forEach((item) => {
        const cluster = this.findNearbyMarkerCluster(clusters, item.latitude, item.longitude)
        if (cluster) {
          cluster.items.push(item)
          return
        }

        clusters.push({
          anchorLatitude: item.latitude,
          anchorLongitude: item.longitude,
          items: [item]
        })
      })

    const markers = []

    clusters.forEach((cluster) => {
      cluster.items.forEach((item, index) => {
        const displayPoint = this.getMarkerDisplayPoint(
          cluster.anchorLatitude,
          cluster.anchorLongitude,
          index,
          cluster.items.length
        )

        markers.push({
          id: markerId++,
          latitude: displayPoint.latitude,
          longitude: displayPoint.longitude,
          width: 30,
          height: 30,
          callout: {
            content: item.vehicleId,
            display: 'ALWAYS',
            fontSize: 12,
            padding: 6,
            borderRadius: 16,
            color: '#ffffff',
            bgColor: item.status === 'RUNNING' ? '#0f766e' : '#9aa8b4',
            borderColor: item.status === 'RUNNING' ? '#0f766e' : '#9aa8b4',
            borderWidth: 1
          }
        })
      })
    })

    return markers
  },

  findNearbyMarkerCluster(clusters, latitude, longitude) {
    const MAX_OVERLAP_DISTANCE_METERS = 18
    return clusters.find(cluster => (
      this.calculateDistanceMeters(
        cluster.anchorLatitude,
        cluster.anchorLongitude,
        latitude,
        longitude
      ) <= MAX_OVERLAP_DISTANCE_METERS
    ))
  },

  getMarkerDisplayPoint(latitude, longitude, index, total) {
    if (total <= 1) {
      return { latitude, longitude }
    }

    const markersPerRing = 6
    const ringIndex = Math.floor(index / markersPerRing)
    const positionInRing = index % markersPerRing
    const pointsInThisRing = Math.min(markersPerRing, total - ringIndex * markersPerRing)
    const radiusMeters = 12 + ringIndex * 8
    const angle = (Math.PI * 2 * positionInRing) / Math.max(pointsInThisRing, 1)

    const latitudeOffset = (radiusMeters * Math.sin(angle)) / 111320
    const longitudeOffset = (radiusMeters * Math.cos(angle))
      / (111320 * Math.max(Math.cos((latitude * Math.PI) / 180), 0.2))

    return {
      latitude: latitude + latitudeOffset,
      longitude: longitude + longitudeOffset
    }
  },

  calculateDistanceMeters(lat1, lng1, lat2, lng2) {
    const toRadians = degree => (degree * Math.PI) / 180
    const earthRadius = 6371000
    const dLat = toRadians(lat2 - lat1)
    const dLng = toRadians(lng2 - lng1)
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
      + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2))
      * Math.sin(dLng / 2) * Math.sin(dLng / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return earthRadius * c
  },

  decorateVehicle(item) {
    const latitude = this.parseCoordinate(item.latitude)
    const longitude = this.parseCoordinate(item.longitude)
    const speed = typeof item.speed === 'number' ? item.speed : 0
    const status = item.status || 'UNKNOWN'
    const updateTimeText = this.formatUpdateTime(item.updateTime)
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
      latitude,
      longitude,
      status,
      statusText: statusTextMap[status] || '待更新',
      statusClass: statusClassMap[status] || 'vehicle-status-idle',
      latitudeText: this.formatCoordinateText(latitude),
      longitudeText: this.formatCoordinateText(longitude),
      coordinateText: latitude !== null && longitude !== null
        ? `${latitude.toFixed(6)} / ${longitude.toFixed(6)}`
        : '等待定位',
      speedText: `${Number(speed || 0).toFixed(1)} m/s`,
      updateTimeText
    }
  },

  parseCoordinate(value) {
    if (value === null || value === undefined || value === '') {
      return null
    }
    const num = Number(value)
    return Number.isFinite(num) ? num : null
  },

  formatCoordinateText(value) {
    return value !== null ? value.toFixed(6) : '--'
  },

  updateLastUpdate(mode) {
    this.setData({
      lastUpdateMode: mode,
      lastUpdateText: this.formatClock(new Date())
    })
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
