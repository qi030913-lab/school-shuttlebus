const { request, WS_URL } = require('../../utils')

const VEHICLE_MARKER_ICON = '/assets/bus-marker.png'
const USER_MARKER_ICON = '/assets/user-marker.png'
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
    userLocationText: '允许定位后可显示你与车辆的距离'
  },

  async onLoad() {
    this.socketTask = null
    this.socketReconnectTimer = null
    this.socketClosedByUser = false
    this.socketRetryCount = 0
    this.shouldResetMapCenter = true
    this.userLocation = null
    this.latestVehiclesRaw = []
    this.locationPollTimer = null

    await this.refreshUserLocation(true)
    await this.loadRoutes()
    this.connectSocket()

    this.pollTimer = setInterval(() => {
      this.loadOverview(false)
    }, POLL_INTERVAL_MS)

    this.startLocationPolling()
  },

  onUnload() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    if (this.locationPollTimer) {
      clearInterval(this.locationPollTimer)
      this.locationPollTimer = null
    }
    this.clearSocketReconnectTimer()
    this.socketClosedByUser = true
    if (this.socketTask) {
      this.socketTask.close()
      this.socketTask = null
    }
  },

  startLocationPolling() {
    if (this.locationPollTimer) {
      return
    }
    this.locationPollTimer = setInterval(() => {
      this.refreshUserLocation(true)
    }, POLL_INTERVAL_MS)
  },

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

  getLocation() {
    return new Promise((resolve, reject) => {
      wx.getLocation({
        type: 'gcj02',
        success: resolve,
        fail: reject
      })
    })
  },

  async ensureLocationPermission(silent = true) {
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
        } catch (e) {
          if (!silent) {
            wx.showToast({ title: '请允许定位后再查看距离', icon: 'none' })
          }
          return false
        }
      }

      if (!silent) {
        wx.showToast({ title: '定位权限已关闭，请在设置中开启', icon: 'none' })
      }
      return false
    } catch (e) {
      if (!silent) {
        wx.showToast({ title: '定位权限检查失败', icon: 'none' })
      }
      return false
    }
  },

  async refreshUserLocation(silent = true) {
    const hasPermission = await this.ensureLocationPermission(silent)
    if (!hasPermission) {
      if (!this.userLocation) {
        this.setData({
          userLocationText: '允许定位后可显示你与车辆的距离'
        })
      }
      return false
    }

    try {
      const location = await this.getLocation()
      this.userLocation = {
        latitude: Number(location.latitude),
        longitude: Number(location.longitude)
      }
      this.setData({
        userLocationText: '已显示你的位置，并连线到在线车辆'
      })
      this.applyVehicles(this.latestVehiclesRaw)
      return true
    } catch (e) {
      if (!silent) {
        wx.showToast({ title: '获取你的定位失败', icon: 'none' })
      }
      return false
    }
  },

  setSocketStatus(status) {
    this.socketStatus = status || 'disconnected'
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
        this.applyVehicles(filtered)
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

  async refreshAll() {
    await this.refreshUserLocation(false)
    await this.loadOverview(true)
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

    this.applyVehicles(vehicles)
  },

  applyVehicles(vehicles) {
    this.latestVehiclesRaw = Array.isArray(vehicles) ? vehicles : []
    const decoratedVehicles = this.latestVehiclesRaw.map(item => this.decorateVehicle(item))
    const vehicleMarkers = this.buildVehicleMarkers(decoratedVehicles)
    const userMarker = this.buildUserMarker()
    const markers = userMarker ? [...vehicleMarkers, userMarker] : vehicleMarkers
    const distanceLines = this.buildDistanceLines(decoratedVehicles)

    const nextState = {
      vehicles: decoratedVehicles,
      markers,
      polyline: distanceLines
    }

    if (this.shouldResetMapCenter) {
      const firstMarker = vehicleMarkers[0] || userMarker
      nextState.mapLatitude = firstMarker ? firstMarker.latitude : 39.909
      nextState.mapLongitude = firstMarker ? firstMarker.longitude : 116.397
      this.shouldResetMapCenter = false
    }

    this.setData(nextState)
  },

  buildUserMarker() {
    if (!this.userLocation) {
      return null
    }

    return {
      id: 999999,
      latitude: this.userLocation.latitude,
      longitude: this.userLocation.longitude,
      iconPath: USER_MARKER_ICON,
      width: 28,
      height: 28,
      anchor: {
        x: 0.5,
        y: 0.5
      },
      callout: {
        content: '我',
        display: 'BYCLICK',
        fontSize: 11,
        padding: 4,
        borderRadius: 12,
        color: '#0f172a',
        bgColor: '#ffffff',
        borderColor: '#93c5fd',
        borderWidth: 1
      }
    }
  },

  buildDistanceLines(vehicles) {
    if (!this.userLocation) {
      return []
    }

    return vehicles
      .filter(item => item.latitude !== null && item.longitude !== null)
      .map(item => ({
        points: [
          {
            latitude: this.userLocation.latitude,
            longitude: this.userLocation.longitude
          },
          {
            latitude: item.latitude,
            longitude: item.longitude
          }
        ],
        color: item.status === 'RUNNING' ? '#0f766ecc' : '#94a3b8cc',
        width: 4,
        dottedLine: true
      }))
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
          iconPath: VEHICLE_MARKER_ICON,
          width: 34,
          height: 34,
          anchor: {
            x: 0.5,
            y: 0.7
          },
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
    const distanceMeters = this.userLocation && latitude !== null && longitude !== null
      ? this.calculateDistanceMeters(
        this.userLocation.latitude,
        this.userLocation.longitude,
        latitude,
        longitude
      )
      : null

    return {
      ...item,
      latitude,
      longitude,
      status: item.status || 'UNKNOWN',
      distanceText: distanceMeters === null ? '未开启用户定位' : `距离你 ${this.formatDistance(distanceMeters)}`,
      speedText: `${Number(speed || 0).toFixed(1)} m/s`
    }
  },

  parseCoordinate(value) {
    if (value === null || value === undefined || value === '') {
      return null
    }
    const num = Number(value)
    return Number.isFinite(num) ? num : null
  },

  formatDistance(distanceMeters) {
    if (distanceMeters < 1000) {
      return `${Math.round(distanceMeters)}m`
    }
    if (distanceMeters < 10000) {
      return `${(distanceMeters / 1000).toFixed(1)}km`
    }
    return `${Math.round(distanceMeters / 1000)}km`
  }
})
