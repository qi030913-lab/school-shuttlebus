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
    routeProgressWidth: '72%',
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
      this.userLocation = null
      this.setData({
        userLocationText: '允许定位后可显示你与车辆的距离'
      })
      if (this.latestVehiclesRaw) {
        this.applyVehicles(this.latestVehiclesRaw)
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
      this.userLocation = null
      this.setData({
        userLocationText: '获取定位失败，暂不显示你与车辆的距离'
      })
      if (this.latestVehiclesRaw) {
        this.applyVehicles(this.latestVehiclesRaw)
      }
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
        await this.loadOverview(false, first.routeId)
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

    this.loadOverview(true, route.routeId || '')
  },

  async refreshAll() {
    await this.refreshUserLocation(false)
    await this.loadOverview(true)
  },

  goToVehicleDetail(e) {
    const { vehicleId } = e.currentTarget.dataset || {}
    if (!vehicleId) {
      return
    }

    const query = [
      `vehicleId=${encodeURIComponent(vehicleId)}`,
      `routeId=${encodeURIComponent(this.data.currentRouteId || '')}`,
      `routeName=${encodeURIComponent(this.data.routeName || '')}`,
      `serviceTime=${encodeURIComponent(this.data.routeServiceTime || '')}`
    ].join('&')

    wx.navigateTo({
      url: `/pages/vehicles/index?${query}`
    })
  },

  async loadOverview(showLoading = true, routeId = '') {
    const shouldShowLoading = typeof showLoading === 'boolean' ? showLoading : true
    const targetRouteId = routeId || this.data.currentRouteId
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
    const nextServiceTime = route.serviceTime || this.data.routeServiceTime

    this.setData({
      routeName: route.routeName || this.data.routeName,
      routeServiceTime: nextServiceTime,
      routeProgressWidth: this.getRouteProgressWidth(nextServiceTime)
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
      const firstVehicle = decoratedVehicles.find(item => item.latitude !== null && item.longitude !== null)
      const firstPoint = firstVehicle || userMarker
      nextState.mapLatitude = firstPoint ? firstPoint.latitude : 39.909
      nextState.mapLongitude = firstPoint ? firstPoint.longitude : 116.397
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

    vehicles
      .filter(item => item.latitude !== null && item.longitude !== null)
      .forEach((item) => {
        const cluster = this.findMarkerClusterByCoordinate(clusters, item.latitude, item.longitude)
        if (cluster) {
          cluster.items.push(item)
          return
        }

        clusters.push({
          latitude: item.latitude,
          longitude: item.longitude,
          items: [item]
        })
      })

    return clusters.map((cluster, index) => {
      const clusterStatus = this.getClusterStatus(cluster.items)

      return {
          id: index + 1,
          latitude: cluster.latitude,
          longitude: cluster.longitude,
          iconPath: VEHICLE_MARKER_ICON,
          width: cluster.items.length > 1 ? 38 : 34,
          height: cluster.items.length > 1 ? 38 : 34,
          anchor: {
            x: 0.5,
            y: 0.7
          },
          callout: {
            content: this.buildVehicleMarkerLabel(cluster.items),
            display: 'ALWAYS',
            fontSize: 12,
            padding: 6,
            borderRadius: 16,
            color: '#ffffff',
            bgColor: clusterStatus === 'RUNNING' ? '#0f766e' : '#9aa8b4',
            borderColor: clusterStatus === 'RUNNING' ? '#0f766e' : '#9aa8b4',
            borderWidth: 1
          }
        }
    })
  },

  findMarkerClusterByCoordinate(clusters, latitude, longitude) {
    return clusters.find(cluster => (
      cluster.latitude === latitude && cluster.longitude === longitude
    ))
  },

  getClusterStatus(items) {
    return items.some(item => item.status === 'RUNNING') ? 'RUNNING' : 'STOPPED'
  },

  buildVehicleMarkerLabel(items) {
    if (!items.length) {
      return ''
    }

    if (items.length === 1) {
      return items[0].vehicleId
    }

    return `${items[0].vehicleId} 等${items.length}辆`
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
      speedText: `${Number(speed || 0).toFixed(1)} m/s`,
      speedValueText: Number(speed || 0).toFixed(1),
      speedUnitText: 'm/s'
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
  },

  parseTimeToMinutes(value) {
    const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/)
    if (!match) {
      return null
    }

    const hours = Number(match[1])
    const minutes = Number(match[2])
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
      return null
    }

    return hours * 60 + minutes
  }
})
