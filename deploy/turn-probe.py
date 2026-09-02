#!/usr/bin/env python3
"""Проверка TURN снаружи: отвечает ли coturn на STUN Binding по UDP и TCP.

Запускается с раннера GitHub после деплоя — оттуда сеть не ограничена, а с
самого сервера файрвол хостера не увидеть. Ответ сервера здесь — единственное
доказательство, что порт 3478 открыт до конца пути: и в ufw, и у хостера.

    python3 deploy/turn-probe.py <host> [port]

Печатает по строке на транспорт и выходит с 0, если ответил хотя бы UDP
(WebRTC ходит через TURN в первую очередь по UDP); иначе — 1.
"""
import os
import socket
import struct
import sys

MAGIC = 0x2112A442
BINDING_REQUEST = 0x0001
BINDING_OK = (0x0101, 0x0111)  # success / error — любой из них значит «STUN живой»


def request():
    tid = os.urandom(12)
    return struct.pack("!HHI", BINDING_REQUEST, 0, MAGIC) + tid, tid


def is_reply(data, tid):
    if len(data) < 20:
        return False
    kind, _, magic = struct.unpack("!HHI", data[:8])
    return magic == MAGIC and data[8:20] == tid and kind in BINDING_OK


def probe_udp(host, port, timeout):
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.settimeout(timeout)
    try:
        req, tid = request()
        s.sendto(req, (host, port))
        data, _ = s.recvfrom(1500)
        return is_reply(data, tid)
    except OSError:
        return False
    finally:
        s.close()


def probe_tcp(host, port, timeout):
    try:
        with socket.create_connection((host, port), timeout=timeout) as s:
            s.settimeout(timeout)
            req, tid = request()
            s.sendall(req)
            data = b""
            while len(data) < 20:
                chunk = s.recv(1500)
                if not chunk:
                    break
                data += chunk
            return is_reply(data, tid)
    except OSError:
        return False


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    host = argv[1]
    port = int(argv[2]) if len(argv) > 2 else 3478
    timeout = float(os.environ.get("TURN_PROBE_TIMEOUT", "4"))
    udp = probe_udp(host, port, timeout)
    tcp = probe_tcp(host, port, timeout)
    word = lambda ok: "отвечает" if ok else "не отвечает"
    print(f"TURN {host}:{port} udp — {word(udp)}")
    print(f"TURN {host}:{port} tcp — {word(tcp)}")
    if udp:
        print("TURN доступен снаружи")
        return 0
    print("TURN снаружи не отвечает: либо coturn не слушает, либо порт закрыт файрволом хостера")
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
