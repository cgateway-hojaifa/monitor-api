import net from "net";

/**
 * Single TCP connect probe — the primitive the IP monitor is built on.
 *
 * "Up" means the target accepted a TCP connection on the port within the timeout; we measure how
 * long the handshake took, then close immediately without writing anything. This is the standard
 * port-reachability semantic and works for any TCP service (HTTPS, SMTP, MySQL, Redis …) without
 * knowing its protocol.
 *
 * ICMP ping is deliberately not used: raw sockets need root/CAP_NET_RAW, which typically isn't
 * available in a container, and a host that answers ping tells us nothing about whether the port
 * is actually serving.
 */

export interface ProbeResult {
  status: "up" | "down";
  /** Connect latency in ms. Present even on failure (time until refusal/timeout). */
  ping_ms: number;
  message: string;
}

export function tcpProbe(host: string, port: number, timeoutMs: number): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = new net.Socket();
    let settled = false;

    // Every exit path routes through here so the socket is always destroyed exactly once — a
    // leaked handle per check would pile up fast under "Check All".
    const finish = (status: "up" | "down", message: string) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ status, ping_ms: Date.now() - start, message: message.slice(0, 255) });
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish("up", `Connected to ${host}:${port}`));
    socket.once("timeout", () => finish("down", `Timeout after ${timeoutMs}ms`));
    socket.once("error", (err: NodeJS.ErrnoException) => {
      // Map the common errno values to something readable in the heartbeat log.
      const reason =
        err.code === "ECONNREFUSED"
          ? "Connection refused"
          : err.code === "EHOSTUNREACH"
            ? "Host unreachable"
            : err.code === "ENETUNREACH"
              ? "Network unreachable"
              : err.code === "ENOTFOUND"
                ? "Host not found (DNS)"
                : err.code === "ECONNRESET"
                  ? "Connection reset"
                  : err.code || err.message || "Connection error";
      finish("down", reason);
    });

    socket.connect(port, host);
  });
}
