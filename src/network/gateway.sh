#!/bin/sh
set -eu

gateway_refresh_seconds="${GATEWAY_REFRESH_SECONDS:-300}"
allowed_domains="${ALLOWED_DOMAINS:-}"
allowed_ips="${ALLOWED_IPS:-}"
ready_file="/tmp/dijk-gateway-ready"
failed_file="/tmp/dijk-gateway-failed"

has_command() {
    command -v "$1" >/dev/null 2>&1
}

mark_failed() {
    touch "$failed_file"
}

trap mark_failed EXIT

require_firewall_tools() {
    if ! has_command iptables || ! has_command ip6tables; then
        echo "Dijk gateway requires both iptables and ip6tables" >&2
        exit 1
    fi
}

reset_output_rules() {
    iptables -P OUTPUT DROP
    iptables -F OUTPUT
    iptables -A OUTPUT -o lo -j ACCEPT
    iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
    iptables -A OUTPUT -d 127.0.0.11 -p udp --dport 53 -j ACCEPT
    iptables -A OUTPUT -d 127.0.0.11 -p tcp --dport 53 -j ACCEPT

    ip6tables -P OUTPUT DROP
    ip6tables -F OUTPUT
    ip6tables -A OUTPUT -o lo -j ACCEPT
    ip6tables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
}

allow_ip() {
    ip="$1"

    case "$ip" in
        *:*)
            ip6tables -A OUTPUT -d "$ip" -j ACCEPT
            ;;
        *)
            iptables -A OUTPUT -d "$ip" -j ACCEPT
            ;;
    esac
}

resolve_domain() {
    domain="$1"

    if has_command getent; then
        getent ahosts "$domain" 2>/dev/null | awk '{ print $1 }' | sort -u
        return
    fi

    if has_command dig; then
        dig +short A "$domain" 2>/dev/null
        dig +short AAAA "$domain" 2>/dev/null
    fi
}

for_csv_value() {
    values="$1"
    callback="$2"

    echo "$values" | tr ',' '\012' | while IFS= read -r value; do
        value="$(echo "$value" | sed 's/^ *//;s/ *$//')"

        if [ -n "$value" ]; then
            "$callback" "$value"
        fi
    done
}

allow_domain() {
    domain="$1"

    resolve_domain "$domain" | while IFS= read -r ip; do
        if [ -n "$ip" ]; then
            allow_ip "$ip"
        fi
    done
}

apply_firewall() {
require_firewall_tools
    reset_output_rules
    for_csv_value "$allowed_domains" allow_domain
    for_csv_value "$allowed_ips" allow_ip
    iptables -A OUTPUT -j REJECT
    ip6tables -A OUTPUT -j REJECT
}

apply_firewall
touch "$ready_file"
trap - EXIT

while true; do
    sleep "$gateway_refresh_seconds"
    apply_firewall
    touch "$ready_file"
done
