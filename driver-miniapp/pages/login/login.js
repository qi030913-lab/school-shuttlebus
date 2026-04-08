const { request } = require('../../common/request')

Page({
  data: {
    driverName: '张师傅',
    vehicleId: 'BUS-01',
    routes: [],
    routeIndex: 0,
    routeText: '加载中...',
    logging: false,
    routeLoading: true,
    routeLoadError: false
  },

  async onLoad() {
    await this.loadRoutes()
  },

  buildRouteText(routes, routeIndex) {
    const route = routes[routeIndex]
    if (!route) {
      return '暂无线路'
    }
    const serviceTime = route.serviceTime ? `（${route.serviceTime}）` : ''
    return `${route.routeName}${serviceTime}`
  },

  async loadRoutes() {
    this.setData({
      routeLoading: true,
      routeLoadError: false,
      routeText: '加载中...'
    })
    try {
      const routes = await request('/api/common/routes')
      const safeRoutes = Array.isArray(routes) ? routes : []
      this.setData({
        routes: safeRoutes,
        routeIndex: 0,
        routeText: this.buildRouteText(safeRoutes, 0),
        routeLoading: false,
        routeLoadError: false
      })
    } catch (e) {
      this.setData({
        routes: [],
        routeIndex: 0,
        routeText: '线路加载失败，请重试',
        routeLoading: false,
        routeLoadError: true
      })
      wx.showToast({ title: '加载线路失败', icon: 'none' })
    }
  },

  onRetryRoutes() {
    this.loadRoutes()
  },

  onDriverNameInput(e) {
    this.setData({ driverName: e.detail.value })
  },

  onVehicleIdInput(e) {
    this.setData({ vehicleId: e.detail.value })
  },

  onRouteChange(e) {
    const routeIndex = Number(e.detail.value)
    this.setData({
      routeIndex,
      routeText: this.buildRouteText(this.data.routes, routeIndex)
    })
  },

  async login() {
    const { driverName, vehicleId, routes, routeIndex, logging, routeLoading, routeLoadError } = this.data
    const route = routes[routeIndex]
    if (logging) {
      return
    }
    if (routeLoading) {
      wx.showToast({ title: '线路正在加载', icon: 'none' })
      return
    }
    if (routeLoadError) {
      wx.showToast({ title: '线路加载失败', icon: 'none' })
      return
    }
    if (!driverName || !vehicleId) {
      wx.showToast({ title: '请填写完整', icon: 'none' })
      return
    }
    if (!route) {
      wx.showToast({ title: '请先选择线路', icon: 'none' })
      return
    }

    this.setData({ logging: true })
    try {
      const loginRes = await new Promise((resolve, reject) => {
        wx.login({
          success: resolve,
          fail: reject
        })
      })
      if (!loginRes.code) {
        throw new Error('未获取到微信登录 code')
      }
      const result = await request('/api/driver/wx-login', 'POST', {
        code: loginRes.code,
        driverName,
        vehicleId,
        routeId: route.routeId
      })
      const driver = result.driver || {}
      wx.setStorageSync('driverInfo', {
        loginToken: result.loginToken,
        mockMode: !!result.mockMode,
        driverName: driver.driverName,
        vehicleId: driver.vehicleId,
        routeId: driver.routeId,
        routeName: route.routeName,
        openId: driver.openId
      })
      wx.showToast({ title: result.mockMode ? 'Mock登录成功' : '登录成功', icon: 'success' })
      wx.redirectTo({ url: '/pages/dashboard/dashboard' })
    } catch (e) {
      const msg = e && e.message ? e.message : (e && e.msg ? e.msg : '登录失败')
      wx.showToast({ title: msg, icon: 'none' })
    } finally {
      this.setData({ logging: false })
    }
  }
})
