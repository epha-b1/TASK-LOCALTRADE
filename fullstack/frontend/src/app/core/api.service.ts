import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ApiService {
  constructor(private readonly http: HttpClient) {}

  get<T>(url: string) {
    return firstValueFrom(this.http.get<T>(url));
  }

  post<T>(url: string, body: unknown) {
    return firstValueFrom(this.http.post<T>(url, body));
  }

  patch<T>(url: string, body: unknown) {
    return firstValueFrom(this.http.patch<T>(url, body));
  }

  put<T>(url: string, body: unknown) {
    return firstValueFrom(this.http.put<T>(url, body));
  }

  delete<T>(url: string) {
    return firstValueFrom(this.http.delete<T>(url));
  }
}
