#!/bin/sh
set -eu

gateway_refresh_seconds="${GATEWAY_REFRESH_SECONDS:-300}"
allowed_domains="${ALLOWED_DOMAINS:-}"
allowed_ips="${ALLOWED_IPS:-}"
ready_file="/tmp/dijk-gateway-ready"
failed_file="/tmp/dijk-gateway-failed"
resolved_dir="/tmp/dijk-resolved"

has_command() {
    command -v "$1" >/dev/null 2>&1
}

mark_failed() {
    touch "$failed_file"
}

trap mark_failed EXIT

require_firewall_tools() {
    for tool in iptables-restore ip6tables-restore; do
        if ! has_command "$tool"; then
            echo "Dijk gateway requires $tool" >&2
            exit 1
        fi
    done
}

# Prints only values that look like IP addresses. dig can print CNAME targets,
# and a hostname in a firewall rule would make the whole ruleset fail to load.
filter_ips() {
    while IFS= read -r value; do
        case "$value" in
            *:*) echo "$value" ;;
            *[!0-9.]* | "") ;;
            *) echo "$value" ;;
        esac
    done
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

# Resolves a domain and remembers the result. If a refresh can't resolve it
# (a DNS hiccup), the last known addresses are reused instead of dropping it.
resolve_domain_cached() {
    domain="$1"
    cache_file="$resolved_dir/$domain"
    ips="$(resolve_domain "$domain" | filter_ips)"

    if [ -n "$ips" ]; then
        echo "$ips" > "$cache_file"
    elif [ -f "$cache_file" ]; then
        echo "Dijk gateway: could not resolve $domain, keeping previous addresses" >&2
    else
        echo "Dijk gateway: could not resolve $domain" >&2
        return
    fi

    cat "$cache_file"
}

csv_values() {
    echo "$1" | tr ',' '\012' | sed 's/^ *//;s/ *$//' | grep -v '^$' || true
}

collect_ips() {
    for domain in $(csv_values "$allowed_domains"); do
        resolve_domain_cached "$domain"
    done

    csv_values "$allowed_ips" | filter_ips
}

# Builds a complete filter table in iptables-restore format. Only the filter
# table is replaced, so Docker's nat rules for its embedded DNS stay intact.
build_ruleset() {
    family="$1"
    ips="$2"

    echo "*filter"
    echo ":INPUT ACCEPT [0:0]"
    echo ":FORWARD ACCEPT [0:0]"
    echo ":OUTPUT DROP [0:0]"
    echo "-A OUTPUT -o lo -j ACCEPT"
    echo "-A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT"

    if [ "$family" = "4" ]; then
        echo "-A OUTPUT -d 127.0.0.11 -p udp --dport 53 -j ACCEPT"
        echo "-A OUTPUT -d 127.0.0.11 -p tcp --dport 53 -j ACCEPT"
    fi

    # Every branch must succeed: under `set -eu`, a false test as the loop's
    # last command would stop the ruleset halfway.
    echo "$ips" | sort -u | while IFS= read -r ip; do
        case "$family:$ip" in
            4: | 6: | 4:*:* | 6:*.*) ;;
            *) echo "-A OUTPUT -d $ip -j ACCEPT" ;;
        esac
    done

    echo "-A OUTPUT -j REJECT"
    echo "COMMIT"
}

# Each iptables-restore call replaces the whole table in one transaction, so
# there is never a moment with no rules, and live connections aren't dropped.
# If loading fails, the previous rules stay in place.
apply_firewall() {
    ips="$(collect_ips)"

    build_ruleset 4 "$ips" | iptables-restore
    build_ruleset 6 "$ips" | ip6tables-restore
}

require_firewall_tools
mkdir -p "$resolved_dir"
apply_firewall
touch "$ready_file"
trap - EXIT

# A failed refresh must not take the gateway down: the app container lives in
# this network namespace, and the last loaded rules are still enforced.
while true; do
    sleep "$gateway_refresh_seconds"

    if ! apply_firewall; then
        echo "Dijk gateway: firewall refresh failed, keeping previous rules" >&2
    fi
done
