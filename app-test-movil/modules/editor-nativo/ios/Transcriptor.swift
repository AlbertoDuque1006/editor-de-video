import Foundation
import AVFoundation
import Speech

struct PalabraTranscrita {
  let texto: String
  let inicio: Double
  let fin: Double
}

final class Transcriptor {
  func transcribir(uri: String, idioma: String) async throws -> [PalabraTranscrita] {
    guard let url = URL(string: uri), url.isFileURL, FileManager.default.fileExists(atPath: url.path) else {
      throw ErrorEditor.mensaje("El archivo no existe: \(uri)")
    }
    let asset = AVURLAsset(url: url)
    guard !asset.tracks(withMediaType: .audio).isEmpty else { return [] }

    let permiso = await withCheckedContinuation { (continuacion: CheckedContinuation<SFSpeechRecognizerAuthorizationStatus, Never>) in
      SFSpeechRecognizer.requestAuthorization { estado in continuacion.resume(returning: estado) }
    }
    guard permiso == .authorized else { throw ErrorEditor.mensaje("Permiso de reconocimiento de voz negado") }
    guard let reconocedor = SFSpeechRecognizer(locale: Locale(identifier: idioma)) else {
      throw ErrorEditor.mensaje("No existe un reconocedor de voz para \(idioma)")
    }
    guard reconocedor.isAvailable else {
      throw ErrorEditor.mensaje("El reconocimiento de voz para \(idioma) no está disponible")
    }

    let temporal = FileManager.default.temporaryDirectory.appendingPathComponent("transcripcion-\(UUID().uuidString).m4a")
    defer { try? FileManager.default.removeItem(at: temporal) }
    guard let exportador = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetAppleM4A) else {
      throw ErrorEditor.mensaje("No se pudo extraer el audio")
    }
    exportador.outputURL = temporal
    exportador.outputFileType = .m4a
    await withCheckedContinuation { (continuacion: CheckedContinuation<Void, Never>) in
      exportador.exportAsynchronously { continuacion.resume() }
    }
    guard exportador.status == .completed else {
      throw ErrorEditor.mensaje("No se pudo extraer el audio: \(exportador.error?.localizedDescription ?? "error desconocido")")
    }

    let solicitud = SFSpeechURLRecognitionRequest(url: temporal)
    solicitud.shouldReportPartialResults = false
    solicitud.addsPunctuation = true
    solicitud.requiresOnDeviceRecognition = reconocedor.supportsOnDeviceRecognition

    return try await withCheckedThrowingContinuation { (continuacion: CheckedContinuation<[PalabraTranscrita], Error>) in
      let bloqueo = NSLock()
      var terminado = false
      var tarea: SFSpeechRecognitionTask?
      tarea = reconocedor.recognitionTask(with: solicitud) { resultado, error in
        guard resultado?.isFinal == true || error != nil else { return }
        bloqueo.lock()
        guard !terminado else { bloqueo.unlock(); return }
        terminado = true
        bloqueo.unlock()
        if let resultado = resultado, resultado.isFinal {
          continuacion.resume(returning: resultado.bestTranscription.segments.map {
            PalabraTranscrita(texto: $0.substring, inicio: $0.timestamp, fin: $0.timestamp + $0.duration)
          })
        } else if let error = error as NSError?, error.domain == "kAFAssistantErrorDomain", error.code == 1110 {
          continuacion.resume(returning: [])
        } else {
          continuacion.resume(throwing: error ?? ErrorEditor.mensaje("No se pudo reconocer la voz"))
        }
        tarea?.cancel()
      }
    }
  }
}
