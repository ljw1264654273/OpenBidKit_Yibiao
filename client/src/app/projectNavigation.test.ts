// @ts-expect-error Vitest is provided by the requested npx test runner, not the client runtime dependencies.
import { describe, expect, it } from 'vitest';
import {
  getMenuNavigationDecision,
  getProjectSection,
} from './projectNavigation';

describe('project navigation decisions', () => {
  it('opens the expansion creation page when the menu has no active project', () => {
    expect(getMenuNavigationDecision({
      activeSection: 'bid-projects',
      requestedSection: 'existing-plan-expansion',
      activeProjectId: null,
    })).toEqual({
      shouldNavigate: true,
      shouldCloseActiveProject: false,
      shouldStartNewExpansion: false,
    });
  });

  it('starts a new expansion project when the expansion menu is clicked inside an active project', () => {
    expect(getMenuNavigationDecision({
      activeSection: 'existing-plan-expansion',
      requestedSection: 'existing-plan-expansion',
      activeProjectId: 'expansion-project',
    })).toEqual({
      shouldNavigate: true,
      shouldCloseActiveProject: true,
      shouldStartNewExpansion: true,
    });
  });

  it('closes an expansion project before entering the ordinary technical-plan workflow', () => {
    expect(getMenuNavigationDecision({
      activeSection: 'existing-plan-expansion',
      requestedSection: 'technical-plan',
      activeProjectId: 'expansion-project',
    })).toEqual({
      shouldNavigate: true,
      shouldCloseActiveProject: true,
      shouldStartNewExpansion: false,
    });
  });

  it('keeps an ordinary project open when the same ordinary workflow menu is clicked', () => {
    expect(getMenuNavigationDecision({
      activeSection: 'technical-plan',
      requestedSection: 'technical-plan',
      activeProjectId: 'technical-project',
    })).toEqual({
      shouldNavigate: false,
      shouldCloseActiveProject: false,
      shouldStartNewExpansion: false,
    });
  });

  it('maps project types to their fixed workbench sections', () => {
    expect(getProjectSection('technical-plan')).toBe('technical-plan');
    expect(getProjectSection('existing-plan-expansion')).toBe('existing-plan-expansion');
  });
});
