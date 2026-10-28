import Foundation
import AVFoundation
import QuartzCore
import CoreGraphics
import CoreText

struct Tramo {
  let uri: String
  let inicio: Double
  let fin: Double
}

struct TextoVideo {
  let texto: String
  let inicio: Double
  let fin: Double
  let posicion: String
  let estilo: String
  let animacion: String
  let color: String
}

struct SubtituloVideo {
  let texto: String
  let inicio: Double
  let fin: Double
}

struct MusicaVideo {
  let uri: String
  let volumen: Double
}

struct PedidoVideo {
  let ancho: Int
  let alto: Int
  let tramos: [Tramo]
  let textos: [TextoVideo]
  let subtitulos: [SubtituloVideo]
  let musica: MusicaVideo?
  let volumenOriginal: Double
}

enum ErrorEditor: LocalizedError {
  case mensaje(String)
  var errorDescription: String? {
    if case .mensaje(let texto) = self { return texto }
    return nil
  }
}

final class Exportador {
  private let escalaTiempo: CMTimeScale = 600

  func exportar(_ pedido: PedidoVideo, progreso: @escaping (Double) -> Void) async throws -> URL {
    guard !pedido.tramos.isEmpty else { throw ErrorEditor.mensaje("No hay tramos para exportar") }
    guard pedido.ancho > 0, pedido.alto > 0 else { throw ErrorEditor.mensaje("Tamaño de video inválido") }

    let composicion = AVMutableComposition()
    guard let video = composicion.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid),
          let audio = composicion.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else {
      throw ErrorEditor.mensaje("No se pudieron crear las pistas del video")
    }
    let instrucciones = AVMutableVideoCompositionInstruction()
    var cursor = CMTime.zero
    let tamaño = CGSize(width: pedido.ancho, height: pedido.alto)

    for tramo in pedido.tramos {
      let url = try archivo(tramo.uri)
      let asset = AVURLAsset(url: url)
      guard let pista = asset.tracks(withMediaType: .video).first else {
        throw ErrorEditor.mensaje("El archivo no tiene video: \(url.lastPathComponent)")
      }
      let duracion = CMTimeGetSeconds(asset.duration)
      let inicio = max(0, tramo.inicio)
      let fin = min(tramo.fin, duracion)
      guard inicio.isFinite, fin.isFinite, fin > inicio else { continue }
      let rango = CMTimeRange(start: tiempo(inicio), duration: tiempo(fin - inicio))
      try video.insertTimeRange(rango, of: pista, at: cursor)
      if let pistaAudio = asset.tracks(withMediaType: .audio).first {
        try audio.insertTimeRange(rango, of: pistaAudio, at: cursor)
      }
      cursor = CMTimeAdd(cursor, rango.duration)
    }
    guard CMTimeCompare(cursor, .zero) > 0 else { throw ErrorEditor.mensaje("No hay tramos con duración válida") }

    instrucciones.timeRange = CMTimeRange(start: .zero, duration: cursor)
    // Una sola pista requiere una sola layer instruction; sus transformaciones cambian en cada tramo.
    let capaVideo = AVMutableVideoCompositionLayerInstruction(assetTrack: video)
    var punto = CMTime.zero
    for tramo in pedido.tramos {
      let url = try archivo(tramo.uri)
      let asset = AVURLAsset(url: url)
      guard let pista = asset.tracks(withMediaType: .video).first else { continue }
      let inicio = max(0, tramo.inicio)
      let fin = min(tramo.fin, CMTimeGetSeconds(asset.duration))
      guard inicio.isFinite, fin.isFinite, fin > inicio else { continue }
      capaVideo.setTransform(transformacionCover(pista, tamaño: tamaño), at: punto)
      punto = CMTimeAdd(punto, tiempo(fin - inicio))
    }
    instrucciones.layerInstructions = [capaVideo]
    let composicionVideo = AVMutableVideoComposition()
    composicionVideo.instructions = [instrucciones]
    composicionVideo.renderSize = tamaño
    composicionVideo.frameDuration = CMTime(value: 1, timescale: 30)
    composicionVideo.animationTool = herramientaTextos(pedido, duracion: CMTimeGetSeconds(cursor), tamaño: tamaño)

    let mezcla = AVMutableAudioMix()
    let clips = AVMutableAudioMixInputParameters(track: audio)
    clips.setVolume(Float(max(0, min(1, pedido.volumenOriginal))), at: .zero)
    var parametros: [AVMutableAudioMixInputParameters] = [clips]
    if let musica = pedido.musica {
      let url = try archivo(musica.uri)
      let asset = AVURLAsset(url: url)
      guard let pista = asset.tracks(withMediaType: .audio).first else {
        throw ErrorEditor.mensaje("La música no tiene pista de audio")
      }
      let duracion = CMTimeGetSeconds(asset.duration)
      guard duracion.isFinite, duracion > 0 else { throw ErrorEditor.mensaje("La música está vacía") }
      guard let pistaMusica = composicion.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else {
        throw ErrorEditor.mensaje("No se pudo crear la pista de música")
      }
      var desde = CMTime.zero
      while CMTimeCompare(desde, cursor) < 0 {
        let resto = CMTimeSubtract(cursor, desde)
        let fragmento = CMTimeMinimum(tiempo(duracion), resto)
        try pistaMusica.insertTimeRange(CMTimeRange(start: .zero, duration: fragmento), of: pista, at: desde)
        desde = CMTimeAdd(desde, fragmento)
      }
      let parametro = AVMutableAudioMixInputParameters(track: pistaMusica)
      let volumen = Float(max(0, min(1, musica.volumen)))
      let fade = CMTimeMinimum(tiempo(1), cursor)
      let comienzoFade = CMTimeSubtract(cursor, fade)
      parametro.setVolume(volumen, at: .zero)
      parametro.setVolumeRamp(fromStartVolume: volumen, toEndVolume: 0, timeRange: CMTimeRange(start: comienzoFade, duration: fade))
      parametros.append(parametro)
    }
    mezcla.inputParameters = parametros

    #if os(macOS)
    let baseCache = ProcessInfo.processInfo.environment["EDITOR_NATIVO_CACHE_DIR"].map { URL(fileURLWithPath: $0, isDirectory: true) }
      ?? FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
    #else
    let baseCache = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
    #endif
    let carpeta = baseCache.appendingPathComponent("exportes", isDirectory: true)
    try FileManager.default.createDirectory(at: carpeta, withIntermediateDirectories: true)
    let formato = DateFormatter()
    formato.dateFormat = "yyyyMMdd-HHmmss"
    let destino = carpeta.appendingPathComponent("video-\(formato.string(from: Date())).mp4")
    if FileManager.default.fileExists(atPath: destino.path) { try FileManager.default.removeItem(at: destino) }
    guard let sesion = AVAssetExportSession(asset: composicion, presetName: AVAssetExportPresetHighestQuality) else {
      throw ErrorEditor.mensaje("No se pudo iniciar la exportación")
    }
    sesion.outputURL = destino
    sesion.outputFileType = .mp4
    sesion.shouldOptimizeForNetworkUse = true
    sesion.videoComposition = composicionVideo
    sesion.audioMix = mezcla
    let observador = Task {
      while !Task.isCancelled {
        progreso(Double(sesion.progress))
        try? await Task.sleep(nanoseconds: 200_000_000)
      }
    }
    await withCheckedContinuation { (continuacion: CheckedContinuation<Void, Never>) in
      sesion.exportAsynchronously { continuacion.resume() }
    }
    observador.cancel()
    guard sesion.status == .completed else {
      throw ErrorEditor.mensaje("Falló la exportación: \(String(describing: sesion.error ?? NSError(domain: "Exportador", code: -1)))")
    }
    progreso(1)
    return destino
  }

  private func archivo(_ uri: String) throws -> URL {
    guard let url = URL(string: uri), url.isFileURL, FileManager.default.fileExists(atPath: url.path) else {
      throw ErrorEditor.mensaje("El archivo no existe: \(uri)")
    }
    return url
  }

  private func tiempo(_ segundos: Double) -> CMTime { CMTime(seconds: segundos, preferredTimescale: escalaTiempo) }

  private func transformacionCover(_ pista: AVAssetTrack, tamaño: CGSize) -> CGAffineTransform {
    let caja = CGRect(origin: .zero, size: pista.naturalSize).applying(pista.preferredTransform)
    let escala = max(tamaño.width / abs(caja.width), tamaño.height / abs(caja.height))
    let centrar = CGAffineTransform(translationX: (tamaño.width - abs(caja.width) * escala) / 2 - caja.minX * escala,
                                    y: (tamaño.height - abs(caja.height) * escala) / 2 - caja.minY * escala)
    return pista.preferredTransform.concatenating(CGAffineTransform(scaleX: escala, y: escala)).concatenating(centrar)
  }

  private func herramientaTextos(_ pedido: PedidoVideo, duracion: Double, tamaño: CGSize) -> AVVideoCompositionCoreAnimationTool {
    let video = CALayer()
    video.frame = CGRect(origin: .zero, size: tamaño)
    let padre = CALayer()
    padre.frame = video.frame
    padre.isGeometryFlipped = true
    padre.addSublayer(video)
    for texto in pedido.textos where texto.fin > texto.inicio {
      let capa = capaTexto(texto.texto, estilo: texto.estilo, color: texto.color, tamaño: tamaño)
      let centroY: CGFloat = texto.posicion == "arriba" ? 0.16 * tamaño.height : texto.posicion == "centro" ? 0.45 * tamaño.height : 0.66 * tamaño.height
      capa.position = CGPoint(x: tamaño.width / 2, y: centroY)
      animar(capa, inicio: texto.inicio, fin: texto.fin, duracion: duracion, tipo: texto.animacion, alto: tamaño.height, subtitulo: false)
      padre.addSublayer(capa)
    }
    for subtitulo in pedido.subtitulos where subtitulo.fin > subtitulo.inicio {
      let capa = capaTexto(subtitulo.texto, estilo: "caption", color: "#FFFFFF", tamaño: tamaño)
      capa.position = CGPoint(x: tamaño.width / 2, y: 0.76 * tamaño.height)
      animar(capa, inicio: subtitulo.inicio, fin: subtitulo.fin, duracion: duracion, tipo: "", alto: tamaño.height, subtitulo: true)
      padre.addSublayer(capa)
    }
    return AVVideoCompositionCoreAnimationTool(postProcessingAsVideoLayer: video, in: padre)
  }

  private func capaTexto(_ texto: String, estilo: String, color: String, tamaño: CGSize) -> CALayer {
    let w = tamaño.width
    let esCaja = estilo == "etiqueta" || estilo == "caption"
    let paddingX = esCaja ? (estilo == "etiqueta" ? 0.025 : 0.02) * w : 0
    let paddingY = esCaja ? (estilo == "etiqueta" ? 0.012 : 0.008) * w : 0
    let tamañoFuente = (estilo == "titulo" ? 0.085 : estilo == "subtitulo" ? 0.058 : estilo == "etiqueta" ? 0.048 : 0.055) * w
    let sistema = CTFontCreateUIFontForLanguage(.system, tamañoFuente, nil)!
    let peso: CGFloat = estilo == "titulo" ? 0.8 : estilo == "subtitulo" ? 0.3 : 0.4
    let rasgos = [kCTFontWeightTrait: NSNumber(value: Double(peso))] as CFDictionary
    let descriptor = CTFontDescriptorCreateWithAttributes([kCTFontTraitsAttribute: rasgos] as CFDictionary)
    let fuente = CTFontCreateCopyWithAttributes(sistema, tamañoFuente, nil, descriptor)
    let fondo = cgColor(color)
    let letras: CGColor = estilo == "etiqueta" ? (luminancia(color) > 0.6 ? CGColor(gray: 0, alpha: 1) : CGColor(gray: 1, alpha: 1)) : estilo == "caption" ? CGColor(gray: 1, alpha: 1) : fondo
    var alineacion = CTTextAlignment.center
    let estiloParrafo = withUnsafePointer(to: &alineacion) { pointer in
      var ajuste = CTParagraphStyleSetting(spec: .alignment, valueSize: MemoryLayout<CTTextAlignment>.size, value: pointer)
      return CTParagraphStyleCreate(&ajuste, 1)
    }
    let atributos: [NSAttributedString.Key: Any] = [
      NSAttributedString.Key(rawValue: kCTFontAttributeName as String): fuente,
      NSAttributedString.Key(rawValue: kCTForegroundColorAttributeName as String): letras,
      NSAttributedString.Key(rawValue: kCTParagraphStyleAttributeName as String): estiloParrafo
    ]
    let cadena = NSAttributedString(string: texto, attributes: atributos)
    let maxAncho = 0.84 * w - 2 * paddingX
    let framesetter = CTFramesetterCreateWithAttributedString(cadena)
    let medido = CTFramesetterSuggestFrameSizeWithConstraints(framesetter, CFRange(location: 0, length: 0), nil,
                                                               CGSize(width: maxAncho, height: .greatestFiniteMagnitude), nil)
    let alturaLinea = CTFontGetAscent(fuente) + CTFontGetDescent(fuente) + CTFontGetLeading(fuente)
    let ancho = min(maxAncho, ceil(medido.width) + 2)
    let alto = min(ceil(medido.height) + 2, ceil(alturaLinea * 3))

    // CATextLayer no dibuja letras al exportar fuera de pantalla: el texto se pinta con CoreText
    // en una imagen y esa imagen es el contenido de la capa. El margen deja espacio a la sombra.
    let margen = esCaja ? 0 : ceil(0.02 * w)
    let caja = CGRect(x: margen, y: margen, width: ancho + 2 * paddingX, height: alto + 2 * paddingY)
    let total = CGSize(width: caja.width + 2 * margen, height: caja.height + 2 * margen)
    let capa = CALayer()
    capa.bounds = CGRect(origin: .zero, size: total)
    capa.anchorPoint = CGPoint(x: 0.5, y: 0.5)
    guard let contexto = CGContext(data: nil, width: Int(total.width), height: Int(total.height), bitsPerComponent: 8, bytesPerRow: 0,
                                   space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
      return capa
    }
    if esCaja {
      let radio = (estilo == "etiqueta" ? 0.02 : 0.015) * w
      contexto.addPath(CGPath(roundedRect: caja, cornerWidth: radio, cornerHeight: radio, transform: nil))
      contexto.setFillColor(estilo == "caption" ? CGColor(gray: 0, alpha: 0.55) : fondo)
      contexto.fillPath()
    } else {
      // En CoreGraphics la y crece hacia arriba: la sombra va hacia abajo con y negativa.
      contexto.setShadow(offset: CGSize(width: 0, height: -0.003 * w), blur: 0.006 * w * 2, color: CGColor(gray: 0, alpha: 0.5))
    }
    let areaTexto = CGRect(x: caja.minX + paddingX, y: caja.minY + paddingY, width: ancho, height: alto)
    let marco = CTFramesetterCreateFrame(framesetter, CFRange(location: 0, length: 0), CGPath(rect: areaTexto, transform: nil), nil)
    CTFrameDraw(marco, contexto)
    capa.contents = contexto.makeImage()
    return capa
  }

  private func animar(_ capa: CALayer, inicio: Double, fin: Double, duracion: Double, tipo: String, alto: CGFloat, subtitulo: Bool) {
    let a = max(0, min(duracion, inicio))
    let b = max(a, min(duracion, fin))
    guard b > a, duracion > 0 else { return }
    capa.opacity = 0
    let opacidad = CAKeyframeAnimation(keyPath: "opacity")
    opacidad.beginTime = AVCoreAnimationBeginTimeAtZero
    opacidad.duration = duracion
    if subtitulo {
      opacidad.keyTimes = [0, NSNumber(value: a / duracion), NSNumber(value: b / duracion), 1]
      opacidad.values = [0, 1, 0, 0]
      opacidad.calculationMode = .discrete
    } else {
      let entrada = min(b, a + 0.35)
      let salida = max(entrada, b - 0.25)
      opacidad.keyTimes = [0, NSNumber(value: a / duracion), NSNumber(value: entrada / duracion), NSNumber(value: salida / duracion), NSNumber(value: b / duracion), 1]
      opacidad.values = [0, 0, 1, 1, 0, 0]
      if tipo == "subir" {
        let mover = CAKeyframeAnimation(keyPath: "position.y")
        mover.beginTime = AVCoreAnimationBeginTimeAtZero
        mover.duration = duracion
        mover.keyTimes = [0, NSNumber(value: a / duracion), NSNumber(value: entrada / duracion), 1]
        mover.values = [capa.position.y + 0.04 * alto, capa.position.y + 0.04 * alto, capa.position.y, capa.position.y]
        mover.isRemovedOnCompletion = false
        mover.fillMode = .both
        capa.add(mover, forKey: "entradaPosicion")
      } else if tipo == "zoom" || tipo == "rebote" {
        let escala = CAKeyframeAnimation(keyPath: "transform.scale")
        escala.beginTime = AVCoreAnimationBeginTimeAtZero
        escala.duration = duracion
        if tipo == "zoom" {
          escala.keyTimes = [0, NSNumber(value: a / duracion), NSNumber(value: entrada / duracion), 1]
          escala.values = [0.6, 0.6, 1, 1]
        } else {
          escala.keyTimes = [0, NSNumber(value: a / duracion), NSNumber(value: (a + 0.7 * (entrada - a)) / duracion), NSNumber(value: entrada / duracion), 1]
          escala.values = [0.3, 0.3, 1.12, 1, 1]
        }
        escala.isRemovedOnCompletion = false
        escala.fillMode = .both
        capa.add(escala, forKey: "entradaEscala")
      }
    }
    opacidad.isRemovedOnCompletion = false
    opacidad.fillMode = .both
    capa.add(opacidad, forKey: "visibilidad")
  }

  private func cgColor(_ hexadecimal: String) -> CGColor {
    let valores = componentes(hexadecimal)
    return CGColor(colorSpace: CGColorSpaceCreateDeviceRGB(), components: [valores.0, valores.1, valores.2, 1])!
  }

  private func luminancia(_ hexadecimal: String) -> CGFloat {
    let c = componentes(hexadecimal)
    return 0.2126 * c.0 + 0.7152 * c.1 + 0.0722 * c.2
  }

  private func componentes(_ hexadecimal: String) -> (CGFloat, CGFloat, CGFloat) {
    let valor = Int(hexadecimal.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16) ?? 0xFFFFFF
    return (CGFloat((valor >> 16) & 255) / 255, CGFloat((valor >> 8) & 255) / 255, CGFloat(valor & 255) / 255)
  }
}
