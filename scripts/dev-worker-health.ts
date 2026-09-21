export class WorkerHealth {
	private lastCheck: number;
	private graceUntil: number;
	private failures = 0;

	constructor(now: number) {
		this.lastCheck = now;
		this.graceUntil = now + 30000;
	}

	check(now: number, healthy: boolean): "wait" | "restart" {
		if (now < this.lastCheck || now - this.lastCheck > 45000) {
			this.failures = 0;
			this.graceUntil = now + 30000;
		}
		this.lastCheck = now;
		if (healthy) this.failures = 0;
		else if (now >= this.graceUntil) this.failures++;
		return this.failures >= 3 ? "restart" : "wait";
	}
}
