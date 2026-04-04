const { request, WS_URL } = require('../../utils')

Page({
  data: {
    routes: [],
    routeIndex: 0,
    currentRouteId: '',
    routeName: '',
    stations: [],
    vehicles: [],
    mapLatitude: 39.909,
    mapLongitude: 116.397,
    markers: [],
    polyline: []
  },

  async onLoad() {
    await this.loadRoutes()
    this.connectSocket()
    this.timer = setInterval(() => {
      this.loadOverview()
    }, 8000)
  },

  onUnload() {
    if (this.timer) {
      clearInterval(this.timer)
    }
    if (this.socketTask) {
      this.socketTask.close()
    }
  },

  async loadRoutes() {
    try {
      const routes = await request('/api/common/routes')
      const first = routes[0] || {}
      this.setData({
        routes,
        currentRouteId: first.routeId || '',
        routeName: first.routeName || ''
      })
      if (first.routeId) {
        this.loadOverview()
      }
    } catch (e) {
      wx.showToast({ title: '加载线路失败', icon: 'none' })
    }
  },

  onRouteChange(e) {
    const routeIndex = Number(e.detail.value)
    const route = this.data.routes[routeIndex]
    this.setData({
      routeIndex,
      currentRouteId: route.routeId,
      routeName: route.routeName
    })
    this.loadOverview()
  },

  async loadOverview() {
    try {
      const overview = await request(`/api/user/overview?routeId=${this.data.currentRouteId}`)
      this.applyOverview(overview)
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  connectSocket() {
    this.socketTask = wx.connectSocket({ url: WS_URL })

    this.socketTask.onOpen(() => {
      console.log('socket connected')
    })

    this.socketTask.onMessage((res) => {
      try {
        const body = JSON.parse(res.data)
        const vehicles = body && body.data ? body.data : []
        const filtered = (vehicles || []).filter(v => !this.data.currentRouteId || v.routeId === this.data.currentRouteId)
        this.applyVehicles(filtered, this.data.stations)
      } catch (e) {
        console.log('socket parse skip', e)
      }
    })
  },

  applyOverview(overview) {
    const stations = overview.stations || []
    const vehicles = overview.vehicles || []
    const route = overview.route || {}
    this.setData({
      stations,
      routeName: route.routeName || this.data.routeName
    })
    this.applyVehicles(vehicles, stations)
  },

  applyVehicles(vehicles, stations) {
    const stationMarkers = (stations || []).map((item, index) => ({
      id: 1000 + index,
      latitude: item.latitude,
      longitude: item.longitude,
      width: 20,
      height: 20,
      title: item.stationName,
      callout: {
        content: item.stationName,
        display: 'BYCLICK',
        fontSize: 10,
        padding: 4,
        borderRadius: 4
      }
    }))

    const vehicleMarkers = (vehicles || [])
      .filter(item => item.latitude && item.longitude)
      .map((item, index) => ({
        id: index + 1,
        latitude: item.latitude,
        longitude: item.longitude,
        width: 28,
        height: 28,
        title: item.vehicleId,
        callout: {
          content: `${item.vehicleId}`,
          display: 'ALWAYS',
          fontSize: 12,
          padding: 4,
          borderRadius: 4
        }
      }))

    const points = (stations || []).map(item => ({ latitude: item.latitude, longitude: item.longitude }))
    const first = vehicleMarkers[0] || stationMarkers[0]

    this.setData({
      vehicles,
      markers: [...stationMarkers, ...vehicleMarkers],
      polyline: points.length ? [{ points, color: '#1aad19', width: 4, dottedLine: false }] : [],
      mapLatitude: first ? first.latitude : 39.909,
      mapLongitude: first ? first.longitude : 116.397
    })
  }
})
