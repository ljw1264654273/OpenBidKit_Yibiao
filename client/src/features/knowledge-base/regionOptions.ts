import { areaList } from '@vant/area-data';

interface RegionOption {
  code: string;
  name: string;
}

export const provinceOptions: RegionOption[] = Object.entries(areaList.province_list)
  .map(([code, name]) => ({ code, name }));

export function getCityOptions(provinceCode: string): RegionOption[] {
  if (!provinceCode) return [];
  return Object.entries(areaList.city_list)
    .filter(([code]) => code.slice(0, 2) === provinceCode.slice(0, 2))
    .map(([code, name]) => ({ code, name }));
}

export function selectProvince(provinceCode: string) {
  return { provinceCode, cityCode: '' };
}

export function formatFolderRegion(province: string | null, city: string | null) {
  if (!province) return city || '';
  return city && city !== province ? `${province} · ${city}` : province;
}
