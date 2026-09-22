import type { BidProject, BidProjectStatus, BidProjectType } from '../types';

export const BID_PROJECT_PAGE_SIZE = 6;

export interface BidProjectListFilters {
  query: string;
  status: 'all' | BidProjectStatus;
  type: 'all' | BidProjectType;
}

export interface BidProjectCounts {
  all: number;
  generating: number;
  incomplete: number;
  completed: number;
}

export interface BidProjectPage {
  items: BidProject[];
  page: number;
  pageCount: number;
}

export function getBidProjectCounts(projects: BidProject[]): BidProjectCounts {
  return {
    all: projects.length,
    generating: projects.filter((project) => project.status === 'generating').length,
    incomplete: projects.filter((project) => project.status === 'incomplete').length,
    completed: projects.filter((project) => project.status === 'completed').length,
  };
}

export function filterBidProjects(projects: BidProject[], filters: BidProjectListFilters): BidProject[] {
  const query = filters.query.trim().toLocaleLowerCase();
  return projects.filter((project) => {
    const matchesQuery = !query || [
      project.projectName,
      project.sourceFileName,
      project.sectionLabel,
    ].some((value) => String(value || '').toLocaleLowerCase().includes(query));
    const matchesStatus = filters.status === 'all' || project.status === filters.status;
    const matchesType = filters.type === 'all' || project.projectType === filters.type;
    return matchesQuery && matchesStatus && matchesType;
  });
}

export function paginateBidProjects(
  projects: BidProject[],
  requestedPage: number,
  pageSize = BID_PROJECT_PAGE_SIZE,
): BidProjectPage {
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const pageCount = Math.max(1, Math.ceil(projects.length / safePageSize));
  const page = Math.min(pageCount, Math.max(1, Math.floor(requestedPage) || 1));
  const start = (page - 1) * safePageSize;
  return {
    items: projects.slice(start, start + safePageSize),
    page,
    pageCount,
  };
}
