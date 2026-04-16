import { Command } from "commander";
import { createInitCommand } from "./commands/init.js";
import { createScanCommand } from "./commands/scan.js";
import { createReportCommand } from "./commands/report.js";
import { createRegisterCommand } from "./commands/register.js";
import { createStatusCommand } from "./commands/status.js";
import { createConfigCommand } from "./commands/config.js";

const VERSION = "0.1.0";

function createProgram(): Command {
  const program = new Command();

  program
    .name("steed")
    .description("Steed CLI — Agent asset visibility")
    .version(VERSION);

  // Add commands
  program.addCommand(createInitCommand());
  createScanCommand(program);
  createReportCommand(program);
  createRegisterCommand(program);
  createStatusCommand(program);
  createConfigCommand(program);

  // Service commands (stub for now)
  const serviceCmd = program
    .command("service")
    .description("Manage Host Service daemon");

  serviceCmd
    .command("start")
    .description("Start Host Service in foreground")
    .action(() => {
      throw new Error("Not implemented: service start");
    });

  serviceCmd
    .command("status")
    .description("Check if service is running")
    .action(() => {
      throw new Error("Not implemented: service status");
    });

  serviceCmd
    .command("stop")
    .description("Stop running service")
    .action(() => {
      throw new Error("Not implemented: service stop");
    });

  serviceCmd
    .command("install")
    .description("Install as system service")
    .action(() => {
      throw new Error("Not implemented: service install");
    });

  serviceCmd
    .command("uninstall")
    .description("Remove system service")
    .action(() => {
      throw new Error("Not implemented: service uninstall");
    });

  serviceCmd
    .command("logs")
    .description("Show service logs")
    .action(() => {
      throw new Error("Not implemented: service logs");
    });

  return program;
}

export function main(): void {
  const program = createProgram();
  program.parse();
}

export { createProgram };
