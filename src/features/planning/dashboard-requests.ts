/** One current request per lane. Identity protects A -> B -> A switches. */
export class DashboardRequestLane {
  private active: AbortController | null = null;
  start(): AbortController {
    this.cancel();
    this.active = new AbortController();
    return this.active;
  }
  isCurrent(request: AbortController): boolean {
    return this.active === request && !request.signal.aborted;
  }
  isPending(): boolean { return this.active !== null; }
  finish(request: AbortController): boolean {
    if (this.active !== request) return false;
    this.active = null;
    return true;
  }
  cancel(): void {
    this.active?.abort();
    this.active = null;
  }
}
