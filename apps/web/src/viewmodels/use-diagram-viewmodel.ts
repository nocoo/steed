import { useCallback, useEffect, useRef, useState } from "react";
import { useBlocker, useNavigate, useParams } from "react-router";
import { diagramSchema, emptyDiagram, type Diagram, type DiagramRecord, type DiagramSummary } from "@steed/api/shared";
import { diagramClient } from "@/lib/diagram-client";

export function useDiagramViewModel() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [list, setList] = useState<DiagramSummary[]>([]);
  const [record, setRecord] = useState<DiagramRecord | null>(null);
  const [draft, setDraft] = useState<Diagram | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const generation = useRef(0);
  const allowNavigation = useRef(false);
  const dirty = draft !== null && draft !== record?.document;
  const blocker = useBlocker(() => dirty && !allowNavigation.current);

  const refreshList = useCallback(async () => {
    const current = generation.current;
    const entries: DiagramSummary[] = [];
    let cursor = "";
    do {
      const page = await diagramClient.list(cursor);
      entries.push(...page.data);
      cursor = page.nextCursor ?? "";
    } while (cursor);
    if (current === generation.current) setList(entries);
  }, []);

  useEffect(() => {
    const current = ++generation.current;
    allowNavigation.current = false;
    setLoading(true);
    setError("");
    setNotice("");
    setRecord(null);
    setDraft(null);
    void (async () => {
      try {
        await refreshList();
        const loaded = id ? await diagramClient.get(id) : null;
        if (current !== generation.current) return;
        setRecord(loaded);
        setDraft(loaded?.document ?? null);
      } catch (cause) {
        if (current === generation.current) setError(String(cause instanceof Error ? cause.message : cause));
      } finally {
        if (current === generation.current) setLoading(false);
      }
    })();
    return () => { generation.current++; };
  }, [id, refreshList]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const perform = async (action: () => Promise<void>) => {
    setBusy(true); setError(""); setNotice("");
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  const save = () => perform(async () => {
    if (!record || !draft) return;
    const current = generation.current;
    const saved = await diagramClient.save(record.id, diagramSchema.parse(draft), record.revision);
    if (current !== generation.current) return;
    setRecord(saved); setDraft((currentDraft) => currentDraft === draft ? saved.document : currentDraft);
    setNotice(`Saved revision ${saved.revision}.`);
    await refreshList();
  });
  const create = (document: Diagram = emptyDiagram()) => perform(async () => {
    const current = generation.current;
    const saved = await diagramClient.save(crypto.randomUUID(), diagramSchema.parse(document), null);
    if (current === generation.current) { allowNavigation.current = true; navigate(`/diagrams/${saved.id}`); }
  });
  const remove = () => perform(async () => {
    if (!record) return;
    const current = generation.current;
    await diagramClient.delete(record.id, record.revision);
    if (current === generation.current) { allowNavigation.current = true; navigate("/diagrams"); }
  });

  return { id, list, record, draft, setDraft, loading, busy, dirty, error, setError, notice, save, create, remove, blocker };
}
