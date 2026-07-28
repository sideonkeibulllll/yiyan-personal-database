declare module "aws4fetch" {
  export class AwsClient {
    constructor(opts: {
      accessKeyId: string;
      secretAccessKey: string;
      service?: string;
      region?: string;
    });
    fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
  }
}
