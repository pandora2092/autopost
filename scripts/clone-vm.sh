#!/usr/bin/env bash
# Клонирование Android VM из шаблона с уникальным MAC.
# Использование: ./clone-vm.sh <template_domain> <new_name> [new_mac]
# Требует: virsh, qemu-img, sudo для доступа к libvirt.
# Переменные окружения (опционально):
#   LIBVIRT_DEFAULT_URI  - например qemu:///system
#   VM_DISK_POOL         - пул libvirt для дисков (по умолчанию default)
#   VM_DISK_PATH         - базовый путь к дискам (если пул не используется)

set -euo pipefail

TEMPLATE_DOMAIN="${1:?Usage: $0 <template_domain> <new_name> [new_mac]}"
NEW_NAME="${2:?Usage: $0 <template_domain> <new_name> [new_mac]}"
NEW_MAC="${3:-}"

# Генерация случайного MAC (52:54:00 - зарезервировано для QEMU/KVM)
generate_mac() {
  printf '52:54:00:%02x:%02x:%02x' $((RANDOM%256)) $((RANDOM%256)) $((RANDOM%256))
}

if [[ -z "$NEW_MAC" ]]; then
  NEW_MAC=$(generate_mac)
fi

# Проверка существования шаблона
if ! virsh dominfo "$TEMPLATE_DOMAIN" &>/dev/null; then
  echo "Ошибка: домен шаблона '$TEMPLATE_DOMAIN' не найден." >&2
  exit 1
fi

if virsh dominfo "$NEW_NAME" &>/dev/null; then
  echo "Ошибка: домен '$NEW_NAME' уже существует." >&2
  exit 1
fi

POOL="${VM_DISK_POOL:-default}"
# Временный XML новой VM
XML_FILE=$(mktemp)
trap 'rm -f "$XML_FILE"' EXIT

# Получить XML шаблона и заменить имя и MAC (без xmlstarlet)
virsh dumpxml "$TEMPLATE_DOMAIN" > "$XML_FILE"
sed -i "/<uuid>/d" "$XML_FILE"
sed -i "s/<name>.*<\/name>/<name>$NEW_NAME<\/name>/" "$XML_FILE"
if grep -q "<mac address=" "$XML_FILE"; then
  sed -i "s/<mac address='[^']*'/<mac address='$NEW_MAC'/" "$XML_FILE"
else
  sed -i "s/\(<interface type='network'>\)/\1\n      <mac address='$NEW_MAC'\/>/" "$XML_FILE"
fi

# Путь к диску шаблона (source в domblklist)
DISK_PATH=$(virsh domblklist "$TEMPLATE_DOMAIN" --details | awk 'NR>1 && /disk/ {print $2; exit}')
if [[ -z "$DISK_PATH" ]]; then
  DISK_PATH=$(virsh domblklist "$TEMPLATE_DOMAIN" --details | awk 'NR>1 {print $NF; exit}')
fi
if [[ -z "$DISK_PATH" ]]; then
  echo "Не удалось определить диск шаблона." >&2
  exit 1
fi
# Если путь относительный (пул), получить полный
if [[ "$DISK_PATH" != /* ]]; then
  DISK_PATH=$(virsh pool-dumpxml "$POOL" 2>/dev/null | grep -oP "<path>\K[^<]+" | head -1)/"$DISK_PATH" || true
fi
NEW_DISK_PATH=""
if [[ -n "$DISK_PATH" && -f "$DISK_PATH" ]]; then
  NEW_DISK_PATH="${DISK_PATH%/*}/${NEW_NAME}.qcow2"
  if [[ -f "$NEW_DISK_PATH" ]]; then
    echo "Диск $NEW_DISK_PATH уже существует." >&2
    exit 1
  fi
  qemu-img create -f qcow2 -b "$DISK_PATH" -F qcow2 "$NEW_DISK_PATH"
  sed -i "s|$DISK_PATH|$NEW_DISK_PATH|g" "$XML_FILE"
else
  if command -v virt-clone &>/dev/null; then
    rm -f "$XML_FILE"
    virt-clone --original "$TEMPLATE_DOMAIN" --name "$NEW_NAME" --auto-clone --mac "$NEW_MAC"
    echo "VM '$NEW_NAME' создана (virt-clone), MAC: $NEW_MAC"
    echo "NEW_MAC=$NEW_MAC"
    echo "NEW_NAME=$NEW_NAME"
    exit 0
  fi
  echo "Не удалось определить путь к диску. Установите virt-clone или задайте VM_DISK_PATH." >&2
  exit 1
fi

# Определить тип/сеть интерфейса и подставить MAC
if ! grep -q "address='$NEW_MAC'" "$XML_FILE"; then
  sed -i "s/<mac address='[^']*'/<mac address='$NEW_MAC'/" "$XML_FILE" || true
fi

virsh define "$XML_FILE"
echo "VM '$NEW_NAME' создана. MAC: $NEW_MAC. Диск: $NEW_DISK_PATH"
echo "NEW_MAC=$NEW_MAC"
echo "NEW_NAME=$NEW_NAME"
