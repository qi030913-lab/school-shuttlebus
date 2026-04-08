function createDashboardTestRouteModule(config) {
  const {
    testStartLatitude,
    testStartLongitude,
    testTargetLatitude,
    testTargetLongitude,
    testLocationIntervalMs,
    testRouteDefaultSpeed,
    testRouteSampleDistanceMeters,
    testManualRoutePoints,
    tencentMapDirectionKey,
    tencentMapDirectionModes
  } = config

  return {
    roundTestCoordinate(value) {
      return Number(Number(value).toFixed(14))
    },

    roundTestSpeed(value) {
      return Number(Number(value).toFixed(2))
    },

    createTestRoutePoint(latitude, longitude) {
      return {
        latitude: this.roundTestCoordinate(latitude),
        longitude: this.roundTestCoordinate(longitude)
      }
    },

    buildBaseTestRoutePoints() {
      return [
        this.createTestRoutePoint(testStartLatitude, testStartLongitude),
        this.createTestRoutePoint(testTargetLatitude, testTargetLongitude)
      ]
    },

    buildManualTestRoutePoints() {
      return testManualRoutePoints.map(([latitude, longitude]) => (
        this.createTestRoutePoint(latitude, longitude)
      ))
    },

    deduplicateRoutePoints(routePoints) {
      const normalizedPoints = []

      ;(routePoints || []).forEach(point => {
        if (!point || typeof point.latitude !== 'number' || typeof point.longitude !== 'number') {
          return
        }

        const normalizedPoint = this.createTestRoutePoint(point.latitude, point.longitude)
        const lastPoint = normalizedPoints[normalizedPoints.length - 1]

        if (
          !lastPoint
          || lastPoint.latitude !== normalizedPoint.latitude
          || lastPoint.longitude !== normalizedPoint.longitude
        ) {
          normalizedPoints.push(normalizedPoint)
        }
      })

      return normalizedPoints.length ? normalizedPoints : this.buildBaseTestRoutePoints()
    },

    calculateDistanceMeters(startPoint, endPoint) {
      const earthRadius = 6378137
      const toRadians = value => value * Math.PI / 180
      const deltaLatitude = toRadians(endPoint.latitude - startPoint.latitude)
      const deltaLongitude = toRadians(endPoint.longitude - startPoint.longitude)
      const startLatitude = toRadians(startPoint.latitude)
      const endLatitude = toRadians(endPoint.latitude)
      const haversine = Math.sin(deltaLatitude / 2) * Math.sin(deltaLatitude / 2)
        + Math.cos(startLatitude) * Math.cos(endLatitude)
        * Math.sin(deltaLongitude / 2) * Math.sin(deltaLongitude / 2)

      return 2 * earthRadius * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
    },

    interpolateTestRoutePoint(startPoint, endPoint, ratio) {
      return this.createTestRoutePoint(
        startPoint.latitude + (endPoint.latitude - startPoint.latitude) * ratio,
        startPoint.longitude + (endPoint.longitude - startPoint.longitude) * ratio
      )
    },

    buildLocationsFromRoutePoints(routePoints) {
      const points = this.deduplicateRoutePoints(routePoints)
      if (points.length < 2) {
        return points.map((point, index) => ({
          latitude: point.latitude,
          longitude: point.longitude,
          speed: index === 0 ? 0 : testRouteDefaultSpeed
        }))
      }

      const cumulativeDistances = [0]
      for (let index = 1; index < points.length; index += 1) {
        cumulativeDistances[index] = cumulativeDistances[index - 1]
          + this.calculateDistanceMeters(points[index - 1], points[index])
      }

      const totalDistance = cumulativeDistances[cumulativeDistances.length - 1]
      if (totalDistance <= 0) {
        return points.map((point, index) => ({
          latitude: point.latitude,
          longitude: point.longitude,
          speed: index === 0 ? 0 : testRouteDefaultSpeed
        }))
      }

      const routeLocations = []
      const sampleCount = Math.max(1, Math.ceil(totalDistance / testRouteSampleDistanceMeters))
      let segmentIndex = 1
      let previousDistance = 0

      for (let sampleIndex = 0; sampleIndex <= sampleCount; sampleIndex += 1) {
        const targetDistance = sampleIndex === sampleCount
          ? totalDistance
          : Math.min(sampleIndex * testRouteSampleDistanceMeters, totalDistance)

        while (
          segmentIndex < cumulativeDistances.length - 1
          && cumulativeDistances[segmentIndex] < targetDistance
        ) {
          segmentIndex += 1
        }

        const endIndex = Math.min(segmentIndex, points.length - 1)
        const startIndex = Math.max(0, endIndex - 1)
        const startPoint = points[startIndex]
        const endPoint = points[endIndex]
        const startDistance = cumulativeDistances[startIndex]
        const endDistance = cumulativeDistances[endIndex]
        const ratio = endDistance > startDistance
          ? (targetDistance - startDistance) / (endDistance - startDistance)
          : 0
        const routePoint = this.interpolateTestRoutePoint(startPoint, endPoint, ratio)
        const lastLocation = routeLocations[routeLocations.length - 1]

        if (
          !lastLocation
          || lastLocation.latitude !== routePoint.latitude
          || lastLocation.longitude !== routePoint.longitude
        ) {
          routeLocations.push({
            latitude: routePoint.latitude,
            longitude: routePoint.longitude,
            speed: sampleIndex === 0
              ? 0
              : this.roundTestSpeed((targetDistance - previousDistance) * 1000 / testLocationIntervalMs)
          })
        }

        previousDistance = targetDistance
      }

      return routeLocations
    },

    buildTestRouteLocations() {
      return this.buildLocationsFromRoutePoints(this.buildManualTestRoutePoints())
    },

    decodeTencentPolyline(polyline) {
      if (!Array.isArray(polyline) || polyline.length < 2) {
        return []
      }

      const decodedPolyline = polyline.slice()
      for (let index = 2; index < decodedPolyline.length; index += 1) {
        decodedPolyline[index] = Number(decodedPolyline[index - 2]) + Number(decodedPolyline[index]) / 1000000
      }

      const routePoints = []
      for (let index = 0; index < decodedPolyline.length - 1; index += 2) {
        routePoints.push(this.createTestRoutePoint(decodedPolyline[index], decodedPolyline[index + 1]))
      }

      return this.deduplicateRoutePoints(routePoints)
    },

    requestTencentDirectionRoute(mode) {
      const [startPoint, targetPoint] = this.buildBaseTestRoutePoints()

      return new Promise((resolve, reject) => {
        wx.request({
          url: `https://apis.map.qq.com/ws/direction/v1/${mode}/`,
          method: 'GET',
          data: {
            from: `${startPoint.latitude},${startPoint.longitude}`,
            to: `${targetPoint.latitude},${targetPoint.longitude}`,
            key: tencentMapDirectionKey
          },
          success: res => {
            const body = res.data || {}
            const status = Number(body.status)
            const routes = body.result && Array.isArray(body.result.routes) ? body.result.routes : []
            const route = routes[0] || null
            const routePoints = route ? this.decodeTencentPolyline(route.polyline) : []

            if (res.statusCode >= 400 || status !== 0 || routePoints.length < 2) {
              reject(body)
              return
            }

            resolve({
              mode,
              routePoints
            })
          },
          fail: err => reject(err)
        })
      })
    },

    async ensurePlannedTestRouteLocations() {
      if (
        this.testRouteCache
        && Array.isArray(this.testRouteCache.routeLocations)
        && this.testRouteCache.routeLocations.length > 1
      ) {
        return this.testRouteCache
      }

      let lastError = null

      for (let index = 0; index < tencentMapDirectionModes.length; index += 1) {
        const mode = tencentMapDirectionModes[index]

        try {
          const route = await this.requestTencentDirectionRoute(mode)
          const routeLocations = this.buildLocationsFromRoutePoints(route.routePoints)

          if (routeLocations.length > 1) {
            this.testRouteCache = {
              mode,
              routeLocations
            }
            return this.testRouteCache
          }
        } catch (error) {
          lastError = error
        }
      }

      return {
        mode: 'manual',
        routeLocations: this.buildTestRouteLocations(),
        error: lastError
      }
    },

    buildTestLocation(advance = false) {
      if (!this.testLocationState) {
        this.testLocationState = {
          routeLocations: this.buildTestRouteLocations(),
          currentStep: 0
        }
      } else if (advance && this.testLocationState.currentStep < this.testLocationState.routeLocations.length - 1) {
        this.testLocationState = {
          ...this.testLocationState,
          currentStep: this.testLocationState.currentStep + 1
        }
      }

      return this.testLocationState.routeLocations[this.testLocationState.currentStep]
    },

    hasReachedTestTarget() {
      return !!this.testLocationState
        && this.testLocationState.currentStep >= this.testLocationState.routeLocations.length - 1
    }
  }
}

module.exports = {
  createDashboardTestRouteModule
}
