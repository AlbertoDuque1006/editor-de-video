import { useEscape, MOD } from './util'

const k = (key: string) => (MOD === '⌘' ? `⌘${key}` : `Ctrl+${key}`)

const GROUPS: [string, [string, string[]][]][] = [
  [
    'Reproducción',
    [
      ['Reproducir o pausar', ['Espacio']],
      ['Un cuadro atrás / adelante', ['←', '→']],
      ['Un segundo atrás / adelante', ['⇧←', '⇧→']],
      ['Ir al inicio / al final', ['Inicio', 'Fin']]
    ]
  ],
  [
    'Edición',
    [
      ['Dividir en el cursor', ['S']],
      ['Eliminar lo seleccionado', ['Supr']],
      ['Duplicar', [k('D')]],
      ['Deshacer / rehacer', [k('Z'), MOD === '⌘' ? '⇧⌘Z' : 'Ctrl+Y']],
      ['Quitar la selección', ['Esc']]
    ]
  ],
  [
    'Vista',
    [
      ['Acercar / alejar la línea de tiempo', [k('+'), k('−')]],
      ['Ajustar la línea de tiempo a la ventana', [k('0')]],
      ['Archivos / Asistente IA', [k('1'), k('2')]],
      ['Mostrar u ocultar el inspector', [k('4')]]
    ]
  ],
  [
    'Proyecto',
    [
      ['Proyecto nuevo / abrir / guardar', [k('N'), k('O'), k('S')]],
      ['Importar archivos', [k('I')]],
      ['Exportar video', [k('E')]]
    ]
  ]
]

export function ShortcutsModal({ onClose }: { onClose: () => void }) {
  useEscape(onClose)
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal shortcuts" role="dialog" aria-label="Atajos de teclado">
        <h2>Atajos de teclado</h2>
        <p className="lead small">También puedes hacer clic derecho sobre los clips y los archivos, y acercar la línea de tiempo con {MOD} y la rueda o pellizcando.</p>
        {GROUPS.map(([title, rows]) => (
          <div key={title}>
            <h4>{title}</h4>
            <dl className="shortcut-list">
              {rows.map(([label, keys]) => (
                <div key={label} style={{ display: 'contents' }}>
                  <dt>{label}</dt>
                  <dd>
                    {keys.map((k) => (
                      <kbd key={k}>{k}</kbd>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
        <div className="buttons end">
          <button className="primary" autoFocus onClick={onClose}>
            Listo
          </button>
        </div>
      </div>
    </div>
  )
}
