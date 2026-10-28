import Foundation
import AVFoundation

let carpeta = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let horizontal = carpeta.appendingPathComponent("horizontal.mp4")
let vertical = carpeta.appendingPathComponent("vertical.mp4")
if CommandLine.arguments.contains("--diagnostico") {
  for (nombre, preset) in [("alta-calidad", AVAssetExportPresetHighestQuality), ("passthrough", AVAssetExportPresetPassthrough)] {
    let destino = carpeta.appendingPathComponent("diagnostico-\(nombre).mp4")
    try? FileManager.default.removeItem(at: destino)
    let sesion = AVAssetExportSession(asset: AVURLAsset(url: horizontal), presetName: preset)!
    sesion.outputURL = destino
    sesion.outputFileType = .mp4
    await withCheckedContinuation { (continuacion: CheckedContinuation<Void, Never>) in
      sesion.exportAsynchronously { continuacion.resume() }
    }
    print("DIAGNOSTICO \(nombre)=\(sesion.status.rawValue) \(String(describing: sesion.error))")
    if sesion.status != .completed { try? FileManager.default.removeItem(at: destino) }
  }
  exit(0)
}
let pedido = PedidoVideo(
  ancho: 1080, alto: 1920,
  tramos: [Tramo(uri: horizontal.absoluteString, inicio: 0.4, fin: 3.4),
           Tramo(uri: vertical.absoluteString, inicio: 0.25, fin: 2.75)],
  textos: [
    TextoVideo(texto: "TÍTULO DE PRUEBA", inicio: 0.2, fin: 2.8, posicion: "arriba", estilo: "titulo", animacion: "zoom", color: "#FFFFFF"),
    TextoVideo(texto: "ETIQUETA", inicio: 2.7, fin: 5.3, posicion: "abajo", estilo: "etiqueta", animacion: "rebote", color: "#FFD400"),
    TextoVideo(texto: "Subtítulo central", inicio: 1.1, fin: 4.7, posicion: "centro", estilo: "subtitulo", animacion: "subir", color: "#00FFFF")
  ],
  subtitulos: [
    SubtituloVideo(texto: "Primera frase", inicio: 0.3, fin: 1.4),
    SubtituloVideo(texto: "Segunda frase", inicio: 1.7, fin: 3.2),
    SubtituloVideo(texto: "Tercera frase", inicio: 3.5, fin: 5.2)
  ],
  musica: MusicaVideo(uri: horizontal.absoluteString, volumen: 0.3),
  volumenOriginal: 0.7)

do {
  let salida = try await Exportador().exportar(pedido) { progreso in
    print(String(format: "progreso %.2f", progreso))
  }
  print("VIDEO=\(salida.path)")
} catch {
  print("ERROR=\(error.localizedDescription)")
  exit(1)
}
