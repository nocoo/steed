import { Command } from "commander";

const VERSION = "0.1.0";

function createProgram(): Command {
  const program = new Command();

  program
    .name("steed")
    .description("Steed CLI — Agent asset visibility")
    .version(VERSION);

  program
    .command("init")
    .description("Initialize host configuration")
    .requiredOption("--url <url>", "Worker API URL")
    .requiredOption("--key <key>", "Host API key")
    .action(() => {
      throw new Error("Not implemented: init");
    });

  program
    .command("scan")
    .description("Manually trigger resource scan")
    .option("--agents", "Scan only agents")
    .option("--data-sources", "Scan only data sources")
    .option("--json", "Output as JSON")
    .action(() => {
      throw new Error("Not implemented: scan");
    });

  program
    .command("report")
    .description("Manually trigger snapshot report")
    .option("--dry-run", "Show what would be reported without sending")
    .action(() => {
      throw new Error("Not implemented: report");
    });

  program
    .command("register")
    .description("Register a new agent")
    .requiredOption("--match-key <key>", "Unique identifier (e.g., openclaw:/path)")
    .option("--method <method>", "Detection method: process, config_file, custom")
    .option("--pattern <pattern>", "Detection pattern")
    .option("--version-cmd <cmd>", "Command to get version")
    .option("--nickname <name>", "Display name")
    .option("--role <role>", "Role description")
    .option("--local-only", "Only add to local config")
    .action(() => {
      throw new Error("Not implemented: register");
    });

  program
    .command("status")
    .description("Show current scan status")
    .option("--json", "Output as JSON")
    .action(() => {
      throw new Error("Not implemented: status");
    });

  const configCmd = program
    .command("config")
    .description("Manage configuration");

  configCmd
    .command("show")
    .description("Display current configuration")
    .action(() => {
      throw new Error("Not implemented: config show");
    });

  configCmd
    .command("edit")
    .description("Open config in $EDITOR")
    .action(() => {
      throw new Error("Not implemented: config edit");
    });

  configCmd
    .command("path")
    .description("Print config file path")
    .action(() => {
      throw new Error("Not implemented: config path");
    });

  configCmd
    .command("add-scanner")
    .description("Add a CLI scanner")
    .requiredOption("--name <name>", "Scanner name")
    .requiredOption("--type <type>", "Type: personal_cli or third_party_cli")
    .requiredOption("--binary <binary>", "Binary name")
    .option("--auth-check <check>", "Auth check (format: method:pattern)")
    .action(() => {
      throw new Error("Not implemented: config add-scanner");
    });

  configCmd
    .command("remove-scanner")
    .description("Remove a CLI scanner")
    .requiredOption("--name <name>", "Scanner name")
    .action(() => {
      throw new Error("Not implemented: config remove-scanner");
    });

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
