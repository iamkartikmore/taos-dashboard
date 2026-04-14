import { useStore } from '../store';

export default function BrandSelector() {
  const { brands, activeBrandIds, toggleBrandActive, setAllBrandsActive, setNoBrandsActive } = useStore();

  if (!brands || brands.length <= 1) return null;

  const allActive = brands.every(b => activeBrandIds.includes(b.id));
  const noneActive = brands.every(b => !activeBrandIds.includes(b.id));

  return (
    <div className="flex items-center gap-2 px-6 py-2 border-b border-gray-800/60 bg-gray-950/80 backdrop-blur-sm sticky top-0 z-10 flex-wrap">
      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-600 shrink-0">Brands</span>

      {brands.map(brand => {
        const active = activeBrandIds.includes(brand.id);
        return (
          <button
            key={brand.id}
            onClick={() => toggleBrandActive(brand.id)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all border"
            style={active ? {
              background: `${brand.color}22`,
              borderColor: `${brand.color}66`,
              color: brand.color,
            } : {
              background: 'transparent',
              borderColor: '#374151',
              color: '#64748b',
            }}
          >
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: active ? brand.color : '#374151' }} />
            {brand.name}
          </button>
        );
      })}

      <div className="flex gap-1 ml-auto">
        <button
          onClick={setAllBrandsActive}
          disabled={allActive}
          className="px-2 py-1 text-[10px] text-slate-500 hover:text-slate-300 disabled:opacity-30 transition-colors"
        >
          All
        </button>
        <button
          onClick={setNoBrandsActive}
          disabled={noneActive}
          className="px-2 py-1 text-[10px] text-slate-500 hover:text-slate-300 disabled:opacity-30 transition-colors"
        >
          None
        </button>
      </div>
    </div>
  );
}
