// Three views of the same run:
//   status.log    one human-readable line per check (tail this)
//   events.jsonl  the same events, structured, for scripting
//   status.json   a snapshot of where the run stands right now

const fs = require('fs');
const path = require('path');

const PAD = 13;

class StatusLog {
  constructor(config) {
    this.config = config;
    this.dir = config.logDir;
    this.failureDir = path.join(this.dir, 'failures');
    fs.mkdirSync(this.failureDir, { recursive: true });

    this.statusLogPath = path.join(this.dir, 'status.log');
    this.eventsPath = path.join(this.dir, 'events.jsonl');
    this.snapshotPath = path.join(this.dir, 'status.json');

    this.state = {
      startedAt: new Date().toISOString(),
      endsAt: new Date(Date.now() + config.hours * 3600000).toISOString(),
      baseUrl: config.baseUrl,
      state: 'starting',
      cycle: 0,
      checks: 0,
      failures: 0,
      sections: {},
      lastEvent: null,
      stoppedReason: null
    };
    this.save();
  }

  write(level, message, data) {
    const at = new Date().toISOString();
    const line = `${at}  ${level.padEnd(5)} ${message}`;
    console.log(line);
    fs.appendFileSync(this.statusLogPath, line + '\n');
    fs.appendFileSync(this.eventsPath, JSON.stringify({ at, level, message, ...data }) + '\n');
    this.state.lastEvent = { at, level, message };
  }

  info(message, data = {}) { this.write('INFO', message, data); }
  warn(message, data = {}) { this.write('WARN', message, data); }
  error(message, data = {}) { this.write('ERROR', message, data); }

  cycleStart(cycle) {
    this.state.cycle = cycle;
    this.state.state = 'running';
    this.info(`cycle ${cycle} started`, { event: 'cycle-start', cycle });
    this.save();
  }

  cycleEnd(cycle, ms) {
    this.info(`cycle ${cycle} complete in ${Math.round(ms / 1000)}s`, { event: 'cycle-end', cycle, durationMs: ms });
    this.save();
  }

  // One line per section check: "cycle 3  Orders        OK    2143ms  https://..."
  check(result) {
    const status = result.ok ? 'OK' : 'FAIL';
    const label = `cycle ${result.cycle}  ${result.section.padEnd(PAD)} ${status.padEnd(5)} ${result.durationMs}ms  ${result.url || '-'}`;
    const detail = result.ok ? '' : `\n                          reason: ${result.kind} — ${result.message}`;

    this.state.checks += 1;
    if (!result.ok) this.state.failures += 1;
    this.state.sections[result.section] = {
      lastStatus: status,
      lastCheckedAt: new Date().toISOString(),
      lastDurationMs: result.durationMs,
      lastUrl: result.url || null,
      okCount: (this.state.sections[result.section]?.okCount || 0) + (result.ok ? 1 : 0),
      failCount: (this.state.sections[result.section]?.failCount || 0) + (result.ok ? 0 : 1),
      lastError: result.ok ? null : `${result.kind}: ${result.message}`
    };

    this.write(result.ok ? 'INFO' : 'ERROR', label + detail, { event: 'check', ...result });
    this.save();
  }

  finish(state, reason) {
    this.state.state = state;
    this.state.stoppedReason = reason || null;
    this.state.finishedAt = new Date().toISOString();
    this.save();
  }

  save() {
    fs.writeFileSync(this.snapshotPath, JSON.stringify(this.state, null, 2));
  }

  failureArtifactPath(section, cycle, ext) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return path.join(this.failureDir, `${stamp}_cycle${cycle}_${section.toLowerCase()}.${ext}`);
  }
}

module.exports = { StatusLog };
