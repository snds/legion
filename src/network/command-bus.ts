// ═══════════════════════════════════════════════════════════════════
// COMMAND BUS — Centralized Command Dispatch & History
// All game actions flow through here. Single-player: immediate
// local execution. Multiplayer: queue → send → execute on confirm.
//
// The history buffer enables:
//   - Replay for debugging
//   - Undo/redo (if handlers provide reverse operations)
//   - Network reconciliation (re-apply commands after rollback)
// ═══════════════════════════════════════════════════════════════════

import {
  type GameCommand, type CommandPayload, CommandType,
  createCommand,
} from './commands';
import { Events } from '../core/events';

// ── Handler Registration ─────────────────────────────────────────

type CommandHandler = (cmd: GameCommand) => void;

class CommandBus {
  private handlers = new Map<CommandType, CommandHandler>();
  private history: GameCommand[] = [];
  private pendingQueue: GameCommand[] = [];    // for network mode
  private maxHistory = 1000;
  private networkMode = false;

  /**
   * Register a handler for a command type.
   * Each type has exactly one handler — last registration wins.
   */
  register(type: CommandType, handler: CommandHandler): void {
    this.handlers.set(type, handler);
  }

  /**
   * Dispatch a command. In local mode, executes immediately.
   * In network mode, queues and waits for server confirmation.
   */
  dispatch(type: CommandType, payload: CommandPayload): GameCommand {
    const cmd = createCommand(type, payload);

    if (this.networkMode) {
      this.pendingQueue.push(cmd);
      Events.emit('ui:notification', {
        title: 'Command Queued',
        desc: `${type} pending server confirmation`,
        duration: 1000,
      });
    } else {
      this.execute(cmd);
    }

    return cmd;
  }

  /**
   * Execute a command directly (bypasses network queue).
   * Used for local mode and for confirmed network commands.
   */
  execute(cmd: GameCommand): void {
    const handler = this.handlers.get(cmd.type);
    if (!handler) {
      console.warn(`[CommandBus] No handler for command: ${cmd.type}`);
      return;
    }

    try {
      handler(cmd);
      this.pushHistory(cmd);
    } catch (err) {
      console.error(`[CommandBus] Error executing ${cmd.type}:`, err);
    }
  }

  /**
   * Execute a batch of commands (for replay or network sync).
   */
  executeBatch(commands: GameCommand[]): void {
    for (const cmd of commands) {
      this.execute(cmd);
    }
  }

  // ── Network Integration ──

  /**
   * Enable network mode. Commands queue instead of executing.
   */
  setNetworkMode(enabled: boolean): void {
    this.networkMode = enabled;
  }

  /**
   * Get queued commands (for sending to server).
   */
  flushPending(): GameCommand[] {
    const pending = [...this.pendingQueue];
    this.pendingQueue.length = 0;
    return pending;
  }

  // ── History ──

  private pushHistory(cmd: GameCommand): void {
    this.history.push(cmd);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
  }

  getHistory(): readonly GameCommand[] {
    return this.history;
  }

  getHistorySince(tick: number): GameCommand[] {
    return this.history.filter(cmd => cmd.tick >= tick);
  }

  clearHistory(): void {
    this.history.length = 0;
  }

  // ── Serialization (for save/load) ──

  serializeHistory(): string {
    return JSON.stringify(this.history);
  }

  deserializeHistory(json: string): void {
    this.history = JSON.parse(json) as GameCommand[];
  }

  // ── Debug ──

  debug(): { handlers: string[]; historySize: number; pending: number } {
    return {
      handlers: [...this.handlers.keys()],
      historySize: this.history.length,
      pending: this.pendingQueue.length,
    };
  }
}

// Singleton
export const Bus = new CommandBus();
