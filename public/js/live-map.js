(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RodandoLiveMap = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PROXIMITY_LEGEND = [
    { color: 'green', label: 'Verde: más de 10 min' },
    { color: 'yellow', label: 'Amarillo: 10 min o menos' },
    { color: 'orange', label: 'Naranja: 5 min o menos' },
    { color: 'red', label: 'Rojo: 2 min o menos' }
  ];
  const COLOR_VARIABLES = {
    green: '--live-green', yellow: '--live-yellow', orange: '--live-orange',
    red: '--live-red', gray: '--live-gray'
  };

  function colorVariable(color) {
    return COLOR_VARIABLES[color] || COLOR_VARIABLES.gray;
  }

  function resolveColor(color, variables) {
    const value = variables?.[colorVariable(color)];
    return typeof value === 'string' && value.trim() ? value.trim() : '#8c9b90';
  }

  function routePoints(data) {
    const ride = data?.ride || {};
    return [
      [ride.originLat, ride.originLng],
      [ride.pickupLat, ride.pickupLng],
      [ride.destinationLat, ride.destinationLng]
    ].filter(point => Number.isFinite(point[0]) && Number.isFinite(point[1]));
  }

  function formatUltimaSenal(updatedAt, now = Date.now()) {
    const time = new Date(updatedAt).getTime();
    if (!Number.isFinite(time)) return 'hora desconocida';
    const minutes = Math.max(0, Math.floor((now - time) / 60000));
    if (minutes < 1) return 'hace menos de 1 min';
    if (minutes < 60) return `hace ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `hace ${hours} h`;
    return `hace ${Math.floor(hours / 24)} d`;
  }

  return { PROXIMITY_LEGEND, COLOR_VARIABLES, colorVariable, resolveColor, routePoints, formatUltimaSenal };
});
