import socket

hostname = socket.gethostname()
print(f"Computer: {hostname}")
try:
    ip = socket.gethostbyname(hostname)
except OSError:
    ip = "unknown"
print(f"Detected LAN IP: {ip}")
print(f"Health URL: http://{ip}:8000/health")
print("If the health URL is not reachable from your phone, run allow-firewall.ps1 as Administrator.")
