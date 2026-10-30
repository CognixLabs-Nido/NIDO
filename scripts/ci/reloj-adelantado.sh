# Medición PR-D: adelanta el reloj del runner a $FECHA (10:00 UTC) y lo restaura al salir del
# paso. Se carga con `.` dentro del paso que corre la suite.
sudo timedatectl set-ntp false 2>/dev/null || true
sudo systemctl stop chrony chronyd systemd-timesyncd 2>/dev/null || true
real0=$(date +%s)
up0=$(cut -d' ' -f1 /proc/uptime | cut -d. -f1)
restaurar_reloj() {
  up1=$(cut -d' ' -f1 /proc/uptime | cut -d. -f1)
  sudo date -s "@$((real0 + up1 - up0))" > /dev/null
  echo "reloj restaurado: $(date -u)"
}
trap restaurar_reloj EXIT
sudo date -u -s "${FECHA} 10:00:00" > /dev/null
echo "reloj adelantado: $(date -u)"
