/**
 * Overview response for dashboard home page
 */
export interface Overview {
  hosts: {
    total: number;
    online: number;
    offline: number;
  };
  agents: {
    total: number;
    running: number;
    stopped: number;
    missing: number;
    by_lane: {
      work: number;
      life: number;
      learning: number;
      unassigned: number;
    };
  };
  data_sources: {
    total: number;
    active: number;
    missing: number;
  };
}
