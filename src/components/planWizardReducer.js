import { clone } from '../utils/helpers';

export const A = {
  UPDATE_EX_FIELD:       'UPDATE_EX_FIELD',
  UPDATE_EX_FIELD_BATCH: 'UPDATE_EX_FIELD_BATCH',
  REMOVE_EX:             'REMOVE_EX',
  MOVE_EX:               'MOVE_EX',
  ADD_EXERCISES:         'ADD_EXERCISES',
  GROUP_SUPERSET:        'GROUP_SUPERSET',
  UNGROUP_SUPERSET:      'UNGROUP_SUPERSET',
  MOVE_SUPERSET_UP:      'MOVE_SUPERSET_UP',
  MOVE_SUPERSET_DOWN:    'MOVE_SUPERSET_DOWN',
  UPDATE_DAY_FIELD:      'UPDATE_DAY_FIELD',
  UPDATE_DAY_LABEL:      'UPDATE_DAY_LABEL',
  ADD_DAY:               'ADD_DAY',
  ADD_DAYS:              'ADD_DAYS',
  REMOVE_DAY:            'REMOVE_DAY',
  MOVE_DAY:              'MOVE_DAY',
  REORDER_WEEKS:         'REORDER_WEEKS',
};

export function initBDays({ editPlan, templatePlan }) {
  if (editPlan)     return clone(editPlan.days);
  if (templatePlan) return clone(templatePlan.days);
  return Array.from({ length: 7 }, (_, i) => ({ label: `Day ${i + 1}`, exercises: [] }));
}

function mapDay(days, dayIdx, fn) {
  return days.map((d, i) => i !== dayIdx ? d : fn(d));
}

function mapEx(days, dayIdx, exIdx, fn) {
  return mapDay(days, dayIdx, d => ({
    ...d,
    exercises: d.exercises.map((e, j) => j !== exIdx ? e : fn(e)),
  }));
}

export function bDaysReducer(state, action) {
  switch (action.type) {

    case A.UPDATE_EX_FIELD:
      return mapEx(state, action.dayIdx, action.exIdx,
        e => ({ ...e, [action.field]: action.val }));

    case A.UPDATE_EX_FIELD_BATCH:
      return mapEx(state, action.dayIdx, action.exIdx,
        e => ({ ...e, ...action.fields }));

    case A.REMOVE_EX:
      return mapDay(state, action.dayIdx, d => ({
        ...d,
        exercises: d.exercises.filter((_, j) => j !== action.exIdx),
      }));

    case A.MOVE_EX: {
      const { dayIdx, fromIdx, toIdx } = action;
      if (fromIdx === toIdx) return state;
      return mapDay(state, dayIdx, d => {
        const exs = [...d.exercises];
        const [moved] = exs.splice(fromIdx, 1);
        exs.splice(toIdx, 0, moved);
        return { ...d, exercises: exs };
      });
    }

    case A.ADD_EXERCISES:
      return mapDay(state, action.dayIdx, d => ({
        ...d,
        exercises: [...d.exercises, ...action.exercises],
      }));

    case A.GROUP_SUPERSET:
      return mapDay(state, action.dayIdx, d => ({
        ...d,
        exercises: d.exercises.map((e, ei) =>
          ei === action.idxA ? { ...e, supersetWith: action.idxB }
          : ei === action.idxB ? { ...e, supersetWith: action.idxA }
          : e
        ),
      }));

    case A.UNGROUP_SUPERSET:
      return mapDay(state, action.dayIdx, d => ({
        ...d,
        exercises: d.exercises.map((e, ei) =>
          ei === action.idxA || ei === action.idxB
            ? { ...e, supersetWith: null }
            : e
        ),
      }));

    // Pair at [minI, minI+1] shifts up one slot; element above slides to tail.
    case A.MOVE_SUPERSET_UP: {
      const { dayIdx, minI } = action;
      return mapDay(state, dayIdx, d => {
        const exs = [...d.exercises];
        const above = exs[minI - 1];
        exs[minI - 1] = exs[minI];
        exs[minI]     = exs[minI + 1];
        exs[minI + 1] = above;
        return {
          ...d,
          exercises: exs.map(e => {
            if (e.supersetWith === minI - 1) return { ...e, supersetWith: minI + 1 };
            if (e.supersetWith === minI)     return { ...e, supersetWith: minI - 1 };
            if (e.supersetWith === minI + 1) return { ...e, supersetWith: minI };
            return e;
          }),
        };
      });
    }

    // Pair at [minI, maxI] shifts down one slot; element below slides to head.
    case A.MOVE_SUPERSET_DOWN: {
      const { dayIdx, minI, maxI } = action;
      return mapDay(state, dayIdx, d => {
        const exs = [...d.exercises];
        const below = exs[maxI + 1];
        exs[maxI + 1] = exs[maxI];
        exs[maxI]     = exs[minI];
        exs[minI]     = below;
        return {
          ...d,
          exercises: exs.map(e => {
            if (e.supersetWith === minI)     return { ...e, supersetWith: minI + 1 };
            if (e.supersetWith === minI + 1) return { ...e, supersetWith: minI + 2 };
            if (e.supersetWith === maxI + 1) return { ...e, supersetWith: minI };
            return e;
          }),
        };
      });
    }

    case A.UPDATE_DAY_LABEL:
      return mapDay(state, action.dayIdx, d => ({ ...d, label: action.val }));

    case A.UPDATE_DAY_FIELD:
      return mapDay(state, action.dayIdx, d => ({ ...d, ...action.fields }));

    case A.ADD_DAY:
      return [...state, { label: `Day ${state.length + 1}`, exercises: [] }];

    case A.ADD_DAYS:
      return [...state, ...action.days];

    case A.REMOVE_DAY:
      return state.filter((_, i) => i !== action.dayIdx);

    case A.MOVE_DAY: {
      const { fromIdx, toIdx } = action;
      if (fromIdx === toIdx) return state;
      const days = [...state];
      const [moved] = days.splice(fromIdx, 1);
      days.splice(toIdx, 0, moved);
      return days;
    }

    case A.REORDER_WEEKS: {
      const { fromWeek, toWeek } = action;
      if (fromWeek === toWeek) return state;
      const weeks = [];
      for (let i = 0; i < state.length; i += 7) weeks.push(state.slice(i, i + 7));
      const [moved] = weeks.splice(fromWeek, 1);
      weeks.splice(toWeek, 0, moved);
      return weeks.flat().map((d, i) => ({ ...d, label: `Day ${i + 1}` }));
    }

    default:
      return state;
  }
}
