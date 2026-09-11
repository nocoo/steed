import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { useForm } from "react-hook-form";
import { AlertCircle, Database, Terminal, Plug } from "lucide-react";
import {
  Badge,
  Button,
  DescriptionList,
  Field,
  Input,
  LayerCard,
  toast,
} from "@nocoo/basalt";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { InputArea } from "@nocoo/basalt/components/input-area";
import { SkeletonLine } from "@nocoo/basalt/components/skeleton-line";
import { LaneChips } from "@/components/ui/lane-chips";
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

export function DataSourceDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
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
      <div className="space-y-8">
        <PageHeader title="Data Source" />
        <SkeletonLine className="h-32" minWidth={100} maxWidth={100} />
        <SkeletonLine className="h-64" minWidth={100} maxWidth={100} />
      </div>
    );
  }

  if (error && !dataSource) {
    return (
      <div className="space-y-8">
        <PageHeader title="Data Source" />
        <LayerCard>
          <div className="flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-basalt-destructive" />
            <p className="text-sm text-basalt-destructive">{error}</p>
          </div>
        </LayerCard>
      </div>
    );
  }

  if (!dataSource) return null;

  const lanesDirty = !arraysEqual(
    laneSelection,
    dataSource.lane_ids as LaneId[]
  );

  return (
    <div className="space-y-8">
      <PageHeader
        title={dataSource.name}
        description={formatType(dataSource.type)}
      />

      <LayerCard>
        <LayerCard.Header>
          <div className="flex w-full items-center justify-between">
            <div className="flex items-center gap-3">
              <TypeIcon type={dataSource.type} />
              <span>Identity</span>
            </div>
            <div className="flex items-center gap-2">
              <AuthStatusBadge status={dataSource.auth_status} />
              <StatusBadge status={dataSource.status} />
            </div>
          </div>
        </LayerCard.Header>
        <LayerCard.Body>
          <DescriptionList columns={2}>
            <DescriptionList.Item term="Host">
              {dataSource.host_id}
            </DescriptionList.Item>
            <DescriptionList.Item term="Version">
              {dataSource.version ?? "—"}
            </DescriptionList.Item>
            <DescriptionList.Item term="Created">
              {new Date(dataSource.created_at).toLocaleString()}
            </DescriptionList.Item>
            <DescriptionList.Item term="Last seen">
              {dataSource.last_seen_at
                ? new Date(dataSource.last_seen_at).toLocaleString()
                : "Never"}
            </DescriptionList.Item>
          </DescriptionList>
        </LayerCard.Body>
      </LayerCard>

      <LayerCard>
        <LayerCard.Header>
          <div>
            <p className="font-semibold text-basalt-foreground">Lanes</p>
            <p className="text-sm">
              Pick all business lines this data source belongs to.
            </p>
          </div>
        </LayerCard.Header>
        <LayerCard.Body className="space-y-4">
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
        </LayerCard.Body>
      </LayerCard>

      <LayerCard>
        <LayerCard.Header>
          <div>
            <p className="font-semibold text-basalt-foreground">Metadata</p>
            <p className="text-sm">Notes and tags. Tags are comma-separated.</p>
          </div>
        </LayerCard.Header>
        <LayerCard.Body>
          <form onSubmit={onSubmitMeta} className="space-y-6">
            <Field label="Notes" htmlFor="notes">
              <InputArea
                id="notes"
                rows={4}
                placeholder="Free-form notes about this data source"
                {...register("notes")}
              />
            </Field>
            <Field label="Tags" htmlFor="tags">
              <Input
                id="tags"
                placeholder="primary, internal, staging"
                {...register("tags")}
              />
            </Field>
            <div className="flex justify-end">
              <Button type="submit" disabled={metaSubmitting || !metaDirty}>
                {metaSubmitting ? "Saving..." : "Save metadata"}
              </Button>
            </div>
          </form>
        </LayerCard.Body>
      </LayerCard>
    </div>
  );
}

function arraysEqual(a: LaneId[], b: LaneId[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

function TypeIcon({ type }: { type: DataSourceType }) {
  switch (type) {
    case "personal_cli":
      return <Terminal className="h-5 w-5 text-basalt-muted-foreground" />;
    case "third_party_cli":
      return <Database className="h-5 w-5 text-basalt-muted-foreground" />;
    case "mcp":
      return <Plug className="h-5 w-5 text-basalt-muted-foreground" />;
    default:
      return <Database className="h-5 w-5 text-basalt-muted-foreground" />;
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
