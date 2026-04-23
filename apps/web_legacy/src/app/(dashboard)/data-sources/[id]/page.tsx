"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { ArrowLeft, AlertCircle, Database, Terminal, Plug } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { LaneChips } from "@/components/ui/lane-chips";
import { toast } from "@/components/ui/sonner";
import { useDataSourceDetailViewModel } from "@/viewmodels/use-data-source-detail-viewmodel";
import { parseTagsInput } from "@/lib/schemas";
import type {
  DataSourceType,
  DataSourceAuthStatus,
  DataSourceStatus,
  LaneId,
} from "@steed/shared";

interface MetadataFormValues {
  notes: string;
  tags: string;
}

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function DataSourceDetailPage({ params }: PageProps) {
  const { id } = use(params);
  const { dataSource, loading, error, saveMetadata, saveLanes } =
    useDataSourceDetailViewModel(id);

  const {
    register,
    handleSubmit,
    reset,
    formState: { isSubmitting: metaSubmitting, isDirty: metaDirty },
  } = useForm<MetadataFormValues>({
    defaultValues: { notes: "", tags: "" },
  });

  const [laneSelection, setLaneSelection] = useState<LaneId[]>([]);
  const [laneSubmitting, setLaneSubmitting] = useState(false);

  useEffect(() => {
    if (dataSource) {
      const meta = dataSource.metadata as {
        notes?: unknown;
        tags?: unknown;
      };
      const notes = typeof meta.notes === "string" ? meta.notes : "";
      const tags = Array.isArray(meta.tags)
        ? meta.tags.filter((t): t is string => typeof t === "string").join(", ")
        : "";
      reset({ notes, tags });
      setLaneSelection(dataSource.lane_ids as LaneId[]);
    }
  }, [dataSource, reset]);

  const onSubmitMeta = handleSubmit(async (values) => {
    const merged = {
      ...(dataSource?.metadata ?? {}),
      notes: values.notes.trim() === "" ? null : values.notes.trim(),
      tags: parseTagsInput(values.tags),
    };
    const result = await saveMetadata({ metadata: merged });
    if (result.ok) {
      toast.success("Metadata saved");
    } else {
      toast.error(result.error ?? "Save failed");
    }
  });

  const onSubmitLanes = async () => {
    setLaneSubmitting(true);
    const result = await saveLanes(laneSelection);
    setLaneSubmitting(false);
    if (result.ok) {
      toast.success("Lanes saved");
    } else {
      toast.error(result.error ?? "Save failed");
    }
  };

  if (loading && !dataSource) {
    return (
      <div className="space-y-6">
        <BackLink />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error && !dataSource) {
    return (
      <div className="space-y-6">
        <BackLink />
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-3 pt-6">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <p className="text-sm text-destructive">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!dataSource) return null;

  const lanesDirty = !arraysEqual(
    laneSelection,
    dataSource.lane_ids as LaneId[]
  );

  return (
    <div className="space-y-6">
      <BackLink />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <TypeIcon type={dataSource.type} />
              <div>
                <CardTitle>{dataSource.name}</CardTitle>
                <CardDescription>{formatType(dataSource.type)}</CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <AuthStatusBadge status={dataSource.auth_status} />
              <StatusBadge status={dataSource.status} />
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <Field label="Host">{dataSource.host_id}</Field>
          <Field label="Version">{dataSource.version ?? "—"}</Field>
          <Field label="Created">
            {new Date(dataSource.created_at).toLocaleString()}
          </Field>
          <Field label="Last seen">
            {dataSource.last_seen_at
              ? new Date(dataSource.last_seen_at).toLocaleString()
              : "Never"}
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lanes</CardTitle>
          <CardDescription>
            Pick all business lines this data source belongs to.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <LaneChips
            mode="multi"
            value={laneSelection}
            onChange={setLaneSelection}
            disabled={laneSubmitting}
          />
          <div className="flex justify-end">
            <Button
              type="button"
              onClick={onSubmitLanes}
              disabled={laneSubmitting || !lanesDirty}
            >
              {laneSubmitting ? "Saving..." : "Save lanes"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Metadata</CardTitle>
          <CardDescription>
            Notes and tags. Tags are comma-separated.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmitMeta} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                rows={4}
                placeholder="Free-form notes about this data source"
                {...register("notes")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tags">Tags</Label>
              <Input
                id="tags"
                placeholder="primary, internal, staging"
                {...register("tags")}
              />
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={metaSubmitting || !metaDirty}>
                {metaSubmitting ? "Saving..." : "Save metadata"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function arraysEqual(a: LaneId[], b: LaneId[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

function BackLink() {
  return (
    <Link
      href="/data-sources"
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" />
      Back to data sources
    </Link>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p className="font-medium">{children}</p>
    </div>
  );
}

function TypeIcon({ type }: { type: DataSourceType }) {
  switch (type) {
    case "personal_cli":
      return <Terminal className="h-5 w-5 text-muted-foreground" />;
    case "third_party_cli":
      return <Database className="h-5 w-5 text-muted-foreground" />;
    case "mcp":
      return <Plug className="h-5 w-5 text-muted-foreground" />;
    default:
      return <Database className="h-5 w-5 text-muted-foreground" />;
  }
}

function formatType(type: DataSourceType): string {
  const labels: Record<DataSourceType, string> = {
    personal_cli: "Personal CLI",
    third_party_cli: "Third-party CLI",
    mcp: "MCP Service",
  };
  return labels[type] ?? type;
}

function AuthStatusBadge({ status }: { status: DataSourceAuthStatus }) {
  const variants: Record<
    DataSourceAuthStatus,
    "success" | "secondary" | "outline"
  > = {
    authenticated: "success",
    unauthenticated: "secondary",
    unknown: "outline",
  };
  const labels: Record<DataSourceAuthStatus, string> = {
    authenticated: "Authed",
    unauthenticated: "No Auth",
    unknown: "Unknown",
  };
  return <Badge variant={variants[status]}>{labels[status]}</Badge>;
}

function StatusBadge({ status }: { status: DataSourceStatus }) {
  const variants: Record<DataSourceStatus, "success" | "warning"> = {
    active: "success",
    missing: "warning",
  };
  return <Badge variant={variants[status]}>{status}</Badge>;
}
